#!/usr/bin/env node

/**
 * Migration script to add _name fields to existing documents
 * and create indexes for the new _name-based system
 */

require("dotenv").config();
const { MongoClient } = require("mongodb");
const crypto = require("crypto");

// Helper function to generate 72-bit base64 _name ID (same as server.js)
function generateName() {
  // Generate 9 bytes (72 bits) of random data
  const randomBytes = crypto.randomBytes(9);
  // Convert to base64 and make URL-safe
  return randomBytes.toString('base64url');
}

// Configuration
const BATCH_SIZE = 100; // Process documents in batches
const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose');

let mongoClient;

async function connectToMongoDB() {
  try {
    mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    console.log("✅ Connected to MongoDB Atlas");
    return mongoClient;
  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
    process.exit(1);
  }
}

async function getAllProjectDatabases() {
  try {
    const adminDb = mongoClient.db().admin();
    const databases = await adminDb.listDatabases();
    
    // Filter out system databases and basebase internal database
    const projectDatabases = databases.databases
      .map(db => db.name)
      .filter(name => 
        !name.startsWith('admin') && 
        !name.startsWith('local') && 
        !name.startsWith('config') &&
        name !== 'basebase'
      );

    console.log(`📂 Found ${projectDatabases.length} project databases:`, projectDatabases);
    return projectDatabases;
  } catch (error) {
    console.error("❌ Error listing databases:", error);
    throw error;
  }
}

async function getCollectionsInDatabase(dbName) {
  try {
    const db = mongoClient.db(dbName);
    const collections = await db.listCollections().toArray();
    return collections.map(col => col.name);
  } catch (error) {
    console.error(`❌ Error listing collections in ${dbName}:`, error);
    return [];
  }
}

async function migrateCollection(dbName, collectionName) {
  const db = mongoClient.db(dbName);
  const collection = db.collection(collectionName);
  
  console.log(`\n🔄 Processing ${dbName}.${collectionName}...`);
  
  try {
    // Count total documents
    const totalCount = await collection.countDocuments();
    if (totalCount === 0) {
      console.log(`   ⏭️  Empty collection, skipping`);
      return { processed: 0, updated: 0, errors: 0 };
    }

    // Count documents without _name field
    const withoutNameCount = await collection.countDocuments({ _name: { $exists: false } });
    if (withoutNameCount === 0) {
      console.log(`   ✅ All ${totalCount} documents already have _name field`);
    } else {
      console.log(`   📊 ${withoutNameCount}/${totalCount} documents need _name field`);
    }

    let processed = 0;
    let updated = 0;
    let errors = 0;
    const usedNames = new Set();

    // Get existing _name values to avoid duplicates
    const existingNames = await collection.distinct("_name", { _name: { $exists: true } });
    existingNames.forEach(name => usedNames.add(name));
    
    if (VERBOSE) {
      console.log(`   📝 Found ${existingNames.length} existing _name values`);
    }

    // Process documents in batches
    const cursor = collection.find({ _name: { $exists: false } });
    
    while (await cursor.hasNext()) {
      const batch = [];
      
      // Collect batch
      for (let i = 0; i < BATCH_SIZE && await cursor.hasNext(); i++) {
        const doc = await cursor.next();
        batch.push(doc);
      }

      if (batch.length === 0) break;

      // Process batch
      const bulkOps = [];
      
      for (const doc of batch) {
        let newName;
        let attempts = 0;
        const maxAttempts = 10;
        
        // Generate unique _name
        do {
          newName = generateName();
          attempts++;
          
          if (attempts >= maxAttempts) {
            console.warn(`   ⚠️  Failed to generate unique _name for document ${doc._id} after ${maxAttempts} attempts`);
            errors++;
            break;
          }
        } while (usedNames.has(newName));
        
        if (attempts < maxAttempts) {
          usedNames.add(newName);
          
          bulkOps.push({
            updateOne: {
              filter: { _id: doc._id },
              update: { $set: { _name: newName } }
            }
          });
        }
      }

      // Execute batch update
      if (bulkOps.length > 0 && !DRY_RUN) {
        try {
          const result = await collection.bulkWrite(bulkOps);
          updated += result.modifiedCount;
          
          if (VERBOSE) {
            console.log(`   📝 Updated batch: ${result.modifiedCount}/${bulkOps.length} documents`);
          }
        } catch (batchError) {
          console.error(`   ❌ Batch update error:`, batchError.message);
          errors += bulkOps.length;
        }
      } else if (DRY_RUN) {
        updated += bulkOps.length;
        if (VERBOSE) {
          console.log(`   🧪 [DRY RUN] Would update ${bulkOps.length} documents`);
        }
      }

      processed += batch.length;
      
      // Progress report
      if (processed % (BATCH_SIZE * 10) === 0) {
        console.log(`   📊 Progress: ${processed}/${withoutNameCount} documents processed`);
      }
    }

    await cursor.close();

    console.log(`   ✅ Completed: ${updated} documents updated, ${errors} errors`);
    return { processed, updated, errors };

  } catch (error) {
    console.error(`   ❌ Error processing collection ${dbName}.${collectionName}:`, error.message);
    return { processed: 0, updated: 0, errors: 1 };
  }
}

async function createNameIndex(dbName, collectionName) {
  const db = mongoClient.db(dbName);
  const collection = db.collection(collectionName);
  
  try {
    // Check if index already exists
    const indexes = await collection.listIndexes().toArray();
    const nameIndexExists = indexes.some(idx => 
      idx.key && idx.key._name === 1
    );

    if (nameIndexExists) {
      if (VERBOSE) {
        console.log(`   ✅ _name index already exists on ${dbName}.${collectionName}`);
      }
      return true;
    }

    if (!DRY_RUN) {
      await collection.createIndex(
        { _name: 1 }, 
        { 
          unique: true,
          name: "_name_unique" 
        }
      );
      console.log(`   📋 Created unique _name index on ${dbName}.${collectionName}`);
    } else {
      console.log(`   🧪 [DRY RUN] Would create unique _name index on ${dbName}.${collectionName}`);
    }
    
    return true;
  } catch (error) {
    console.error(`   ❌ Error creating index on ${dbName}.${collectionName}:`, error.message);
    return false;
  }
}

async function runMigration() {
  console.log("🚀 Starting _name field migration...");
  console.log(`📋 Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE MIGRATION'}`);
  console.log(`📋 Batch size: ${BATCH_SIZE}`);
  console.log("─".repeat(50));

  const startTime = Date.now();
  const stats = {
    databases: 0,
    collections: 0,
    totalProcessed: 0,
    totalUpdated: 0,
    totalErrors: 0,
    indexesCreated: 0
  };

  try {
    const databases = await getAllProjectDatabases();
    stats.databases = databases.length;

    for (const dbName of databases) {
      console.log(`\n🗄️  Processing database: ${dbName}`);
      
      const collections = await getCollectionsInDatabase(dbName);
      
      if (collections.length === 0) {
        console.log(`   ⏭️  No collections found, skipping`);
        continue;
      }

      console.log(`   📁 Found ${collections.length} collections: ${collections.join(', ')}`);
      
      for (const collectionName of collections) {
        const result = await migrateCollection(dbName, collectionName);
        
        stats.collections++;
        stats.totalProcessed += result.processed;
        stats.totalUpdated += result.updated;
        stats.totalErrors += result.errors;

        // Create index
        const indexCreated = await createNameIndex(dbName, collectionName);
        if (indexCreated) {
          stats.indexesCreated++;
        }
      }
    }

  } catch (error) {
    console.error("❌ Migration failed:", error);
    stats.totalErrors++;
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  
  console.log("\n" + "=".repeat(50));
  console.log("📊 MIGRATION SUMMARY");
  console.log("=".repeat(50));
  console.log(`⏱️  Duration: ${duration} seconds`);
  console.log(`🗄️  Databases processed: ${stats.databases}`);
  console.log(`📁 Collections processed: ${stats.collections}`);
  console.log(`📄 Documents processed: ${stats.totalProcessed}`);
  console.log(`✅ Documents updated: ${stats.totalUpdated}`);
  console.log(`📋 Indexes created: ${stats.indexesCreated}`);
  console.log(`❌ Errors: ${stats.totalErrors}`);
  
  if (DRY_RUN) {
    console.log("\n🧪 This was a DRY RUN - no changes were made");
    console.log("   Run without --dry-run to apply changes");
  }

  return stats.totalErrors === 0;
}

async function main() {
  console.log("🔧 BaseBase _name Field Migration Tool");
  console.log("=====================================\n");

  if (DRY_RUN) {
    console.log("🧪 DRY RUN MODE - No changes will be made\n");
  }

  try {
    await connectToMongoDB();
    const success = await runMigration();
    
    if (success) {
      console.log("\n🎉 Migration completed successfully!");
      process.exit(0);
    } else {
      console.log("\n💥 Migration completed with errors!");
      process.exit(1);
    }
  } catch (error) {
    console.error("\n💥 Migration failed:", error);
    process.exit(1);
  } finally {
    if (mongoClient) {
      await mongoClient.close();
      console.log("\n📪 Database connection closed");
    }
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Migration interrupted by user');
  if (mongoClient) {
    await mongoClient.close();
  }
  process.exit(1);
});

// Show usage if help requested
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Usage: node scripts/migrate-to-names.js [options]

Options:
  --dry-run    Run without making changes (recommended first)
  --verbose    Show detailed progress information
  --help, -h   Show this help message

Examples:
  node scripts/migrate-to-names.js --dry-run     # Preview changes
  node scripts/migrate-to-names.js --verbose     # Run with detailed logs
  node scripts/migrate-to-names.js              # Run migration
`);
  process.exit(0);
}

// Run the migration
main();