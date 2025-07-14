#!/usr/bin/env node

/**
 * Script to check _name indexes on all collections
 */

require("dotenv").config();
const { MongoClient } = require("mongodb");

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

async function checkIndexes() {
  console.log("🔍 Checking _name indexes on all collections...\n");

  const databases = await getAllProjectDatabases();
  let totalCollections = 0;
  let collectionsWithNameIndex = 0;

  for (const dbName of databases) {
    console.log(`🗄️  Database: ${dbName}`);
    
    const collections = await getCollectionsInDatabase(dbName);
    
    for (const collectionName of collections) {
      totalCollections++;
      const db = mongoClient.db(dbName);
      const collection = db.collection(collectionName);
      
      try {
        const indexes = await collection.listIndexes().toArray();
        
        // Check for _name index
        const nameIndex = indexes.find(idx => 
          idx.key && idx.key._name === 1
        );

        if (nameIndex) {
          collectionsWithNameIndex++;
          const unique = nameIndex.unique ? "✅ unique" : "⚠️  not unique";
          console.log(`   📋 ${collectionName}: ${unique} (${nameIndex.name})`);
        } else {
          console.log(`   ❌ ${collectionName}: No _name index found`);
        }
        
      } catch (error) {
        console.error(`   ❌ ${collectionName}: Error checking indexes - ${error.message}`);
      }
    }
    console.log();
  }

  console.log("=" .repeat(50));
  console.log("📊 INDEX SUMMARY");
  console.log("=" .repeat(50));
  console.log(`📁 Total collections: ${totalCollections}`);
  console.log(`📋 Collections with _name index: ${collectionsWithNameIndex}`);
  console.log(`✅ Coverage: ${((collectionsWithNameIndex / totalCollections) * 100).toFixed(1)}%`);
  
  if (collectionsWithNameIndex === totalCollections) {
    console.log("\n🎉 All collections have _name indexes!");
  } else {
    console.log(`\n⚠️  ${totalCollections - collectionsWithNameIndex} collections missing _name indexes`);
  }
}

async function main() {
  console.log("🔧 BaseBase _name Index Checker");
  console.log("===============================\n");

  try {
    await connectToMongoDB();
    await checkIndexes();
  } catch (error) {
    console.error("\n💥 Check failed:", error);
    process.exit(1);
  } finally {
    if (mongoClient) {
      await mongoClient.close();
      console.log("\n📪 Database connection closed");
    }
  }
}

main();