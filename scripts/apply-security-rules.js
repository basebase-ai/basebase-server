#!/usr/bin/env node

const { MongoClient } = require("mongodb");
require("dotenv").config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017";

// Default security rules for ownerId-based access control
const DEFAULT_OWNER_SECURITY_RULES = [
  {
    match: "/documents/{document}",
    allow: ["read"],
    condition: "true", // Allow all reads for now - can be tightened later
  },
  {
    match: "/documents/{document}",
    allow: ["write"],
    condition:
      "auth != null && (resource == null || resource.data.ownerId == auth.uid)", // Allow creates and owner updates
  },
  {
    match: "/documents/{document}",
    allow: ["delete"],
    condition: "auth != null && resource.data.ownerId == auth.uid", // Only owner can delete
  },
];

async function applySecurityRulesToProject(db, projectName) {
  console.log(`\nApplying security rules to project: ${projectName}`);

  const collectionsCollection = db.collection("collections");

  // Get all actual collections in the database (excluding system collections)
  const collections = await db.listCollections().toArray();
  const userCollections = collections.filter(
    (col) => !col.name.startsWith("system.") && col.name !== "collections"
  );

  if (userCollections.length === 0) {
    console.log(`  No user collections found in ${projectName}`);
    return;
  }

  console.log(`  Found ${userCollections.length} collections to secure`);

  for (const collection of userCollections) {
    const collectionName = collection.name;

    // Check if security rules already exist
    const existingRules = await collectionsCollection.findOne({
      projectName,
      collectionName,
    });

    if (
      existingRules &&
      existingRules.rules &&
      existingRules.rules.length > 0
    ) {
      console.log(
        `    ${collectionName}: Already has security rules, skipping`
      );
      continue;
    }

    // Apply default security rules
    const now = new Date();
    await collectionsCollection.updateOne(
      {
        projectName,
        collectionName,
      },
      {
        $set: {
          projectName,
          collectionName,
          rules: DEFAULT_OWNER_SECURITY_RULES,
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
          indexes: [],
        },
      },
      { upsert: true }
    );

    console.log(
      `    ${collectionName}: Applied default ownerId security rules`
    );
  }
}

async function main() {
  const mongoClient = new MongoClient(MONGO_URI);

  try {
    console.log("🔒 Applying Default Security Rules to Existing Projects");
    console.log("=".repeat(60));

    await mongoClient.connect();
    console.log("✅ Connected to MongoDB");

    // Get all projects from the basebase database
    const basebaseDb = mongoClient.db("basebase");
    const projectsCollection = basebaseDb.collection("projects");

    const projects = await projectsCollection.find({}).toArray();
    console.log(`\nFound ${projects.length} projects:`);

    if (projects.length === 0) {
      console.log("No projects found. Exiting.");
      return;
    }

    // List all projects
    projects.forEach((project, index) => {
      console.log(`  ${index + 1}. ${project.name} (ID: ${project._id})`);
    });

    // Apply security rules to each project's database
    for (const project of projects) {
      const projectDb = mongoClient.db(project._id); // Use sanitized name as database name
      await applySecurityRulesToProject(projectDb, project._id);
    }

    console.log("\n" + "=".repeat(60));
    console.log("✅ Security rules application completed!");
    console.log("\nNext steps:");
    console.log("1. Test document operations to ensure rules are working");
    console.log(
      "2. Update existing documents to include ownerId field if needed"
    );
    console.log("3. Consider tightening read permissions if needed");
  } catch (error) {
    console.error("❌ Error applying security rules:", error);
    process.exit(1);
  } finally {
    await mongoClient.close();
    console.log("\n🔗 Disconnected from MongoDB");
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { applySecurityRulesToProject, DEFAULT_OWNER_SECURITY_RULES };
