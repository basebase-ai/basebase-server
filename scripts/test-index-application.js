/**
 * TEST INDEX APPLICATION SCRIPT
 *
 * This script tests the automatic index application functionality.
 * It verifies that:
 * - Index metadata can be set via the API
 * - Indexes are automatically created when documents are written
 * - Index constraints are properly enforced (e.g., unique indexes)
 * - Different index types work correctly (unique, sparse, text)
 *
 * Usage: npm run test-index-application
 *
 * Requirements:
 * - BaseBase server running on localhost:8000
 * - Valid JWT token (use get-token script first)
 * - MongoDB connection available
 */

const readline = require("readline");
const axios = require("axios");
const { MongoClient } = require("mongodb");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const BASE_URL = "http://localhost:8000";

async function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer);
    });
  });
}

async function setCollectionIndexes(
  projectName,
  collectionName,
  indexes,
  token
) {
  try {
    const response = await axios.put(
      `${BASE_URL}/${projectName}/${collectionName}/_security`,
      { indexes },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );
    return response.data;
  } catch (error) {
    if (error.response) {
      throw new Error(
        `Error ${error.response.status}: ${error.response.data.error}`
      );
    }
    throw error;
  }
}

async function createDocument(projectName, collectionName, document, token) {
  try {
    const response = await axios.post(
      `${BASE_URL}/${projectName}/${collectionName}`,
      document,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );
    return response.data;
  } catch (error) {
    if (error.response) {
      return { error: error.response.data };
    }
    throw error;
  }
}

async function getCollectionIndexes(mongoUri, dbName, collectionName) {
  const client = new MongoClient(mongoUri);
  try {
    await client.connect();
    const db = client.db(dbName);
    const collection = db.collection(collectionName);
    const indexes = await collection.listIndexes().toArray();
    return indexes;
  } finally {
    await client.close();
  }
}

async function dropCollection(mongoUri, dbName, collectionName) {
  const client = new MongoClient(mongoUri);
  try {
    await client.connect();
    const db = client.db(dbName);
    await db.collection(collectionName).drop();
    console.log(`✅ Dropped collection ${dbName}/${collectionName}`);
  } catch (error) {
    if (error.message.includes("ns not found")) {
      console.log(`ℹ️  Collection ${dbName}/${collectionName} doesn't exist`);
    } else {
      console.log(`⚠️  Error dropping collection: ${error.message}`);
    }
  } finally {
    await client.close();
  }
}

function formatIndexes(indexes) {
  return (
    indexes
      .filter((idx) => idx.name !== "_id_")
      .map(
        (idx) =>
          `  ${idx.name}: ${JSON.stringify(idx.key)} ${
            idx.unique ? "(UNIQUE)" : ""
          }`
      )
      .join("\n") || "  (no custom indexes)"
  );
}

async function main() {
  try {
    console.log("🧪 BaseBase Index Application Test\n");

    const token = await question("Enter your JWT token: ");
    const projectName = await question("Enter project name: ");
    const mongoUri = await question("Enter MongoDB URI (with credentials): ");

    const testCollectionName = "index_test_collection";
    const fullCollectionName = `${projectName}/${testCollectionName}`;

    console.log(`\n🧹 Cleaning up any existing test data...`);
    await dropCollection(mongoUri, projectName, testCollectionName);

    console.log(`\n📋 Step 1: Setting up index metadata`);
    const testIndexes = [
      {
        fields: { email: 1 },
        options: { unique: true, name: "email_unique" },
      },
      {
        fields: { username: 1 },
        options: { unique: true, sparse: true, name: "username_unique_sparse" },
      },
      {
        fields: { title: "text", content: "text" },
        options: { name: "text_search_index" },
      },
      {
        fields: { category: 1, priority: -1 },
        options: { name: "category_priority_compound" },
      },
    ];

    const metadata = await setCollectionIndexes(
      projectName,
      testCollectionName,
      testIndexes,
      token
    );
    console.log(`✅ Index metadata set: ${testIndexes.length} indexes defined`);

    console.log(
      `\n📋 Step 2: Creating first document (should trigger index creation)`
    );
    const doc1 = {
      fields: {
        email: { stringValue: "john@example.com" },
        username: { stringValue: "john_doe" },
        title: { stringValue: "Welcome Post" },
        content: { stringValue: "This is my first post about JavaScript" },
        category: { stringValue: "tech" },
        priority: { integerValue: "1" },
      },
    };

    const result1 = await createDocument(
      projectName,
      testCollectionName,
      doc1,
      token
    );
    if (result1.error) {
      console.log(`❌ Failed to create first document: ${result1.error.error}`);
      return;
    }
    console.log(`✅ First document created: ${result1.name}`);

    console.log(`\n📋 Step 3: Checking MongoDB indexes`);
    const mongoIndexes = await getCollectionIndexes(
      mongoUri,
      projectName,
      testCollectionName
    );
    console.log(`MongoDB indexes found:\n${formatIndexes(mongoIndexes)}`);

    const expectedIndexNames = [
      "email_unique",
      "username_unique_sparse",
      "text_search_index",
      "category_priority_compound",
    ];
    const actualIndexNames = mongoIndexes
      .map((idx) => idx.name)
      .filter((name) => name !== "_id_");

    console.log(`\n📊 Index Creation Results:`);
    for (const expectedName of expectedIndexNames) {
      const created = actualIndexNames.includes(expectedName);
      console.log(
        `${created ? "✅" : "❌"} ${expectedName}: ${
          created ? "CREATED" : "MISSING"
        }`
      );
    }

    console.log(
      `\n📋 Step 4: Testing unique constraint (should succeed - different email)`
    );
    const doc2 = {
      fields: {
        email: { stringValue: "jane@example.com" },
        username: { stringValue: "jane_smith" },
        title: { stringValue: "Another Post" },
        content: { stringValue: "This is about Python development" },
        category: { stringValue: "tech" },
        priority: { integerValue: "2" },
      },
    };

    const result2 = await createDocument(
      projectName,
      testCollectionName,
      doc2,
      token
    );
    if (result2.error) {
      console.log(`❌ Unexpected failure: ${result2.error.error}`);
    } else {
      console.log(`✅ Second document created: ${result2.name}`);
    }

    console.log(
      `\n📋 Step 5: Testing unique constraint violation (should fail - duplicate email)`
    );
    const doc3 = {
      fields: {
        email: { stringValue: "john@example.com" }, // Same as first document
        username: { stringValue: "another_john" },
        title: { stringValue: "Duplicate Email Test" },
        content: { stringValue: "This should fail due to duplicate email" },
        category: { stringValue: "test" },
        priority: { integerValue: "1" },
      },
    };

    const result3 = await createDocument(
      projectName,
      testCollectionName,
      doc3,
      token
    );
    if (result3.error) {
      console.log(
        `✅ Correctly rejected duplicate email: ${result3.error.error}`
      );
    } else {
      console.log(
        `❌ PROBLEM: Duplicate email was allowed! Index not enforcing uniqueness.`
      );
    }

    console.log(
      `\n📋 Step 6: Testing sparse unique constraint (should succeed - no username)`
    );
    const doc4 = {
      fields: {
        email: { stringValue: "sparse@example.com" },
        title: { stringValue: "No Username Post" },
        content: { stringValue: "This document has no username field" },
        category: { stringValue: "misc" },
        priority: { integerValue: "3" },
      },
    };

    const result4 = await createDocument(
      projectName,
      testCollectionName,
      doc4,
      token
    );
    if (result4.error) {
      console.log(`❌ Unexpected failure: ${result4.error.error}`);
    } else {
      console.log(`✅ Document without username created: ${result4.name}`);
    }

    console.log(`\n📋 Step 7: Final MongoDB index verification`);
    const finalIndexes = await getCollectionIndexes(
      mongoUri,
      projectName,
      testCollectionName
    );
    console.log(`\nFinal MongoDB indexes:\n${formatIndexes(finalIndexes)}`);

    console.log(`\n🎉 Test completed!`);
    console.log(`\n📊 Summary:`);
    console.log(
      `- Documents created: ${
        [result1, result2, result4].filter((r) => !r.error).length
      }`
    );
    console.log(`- Unique constraint violations: ${result3.error ? 1 : 0}`);
    console.log(
      `- MongoDB indexes created: ${finalIndexes.length - 1} (excluding _id_)`
    );

    const cleanup = await question("\n🧹 Clean up test collection? (y/n): ");
    if (cleanup.toLowerCase() === "y") {
      await dropCollection(mongoUri, projectName, testCollectionName);
      console.log("✅ Test collection cleaned up");
    }
  } catch (error) {
    console.error("\n❌ Test failed:", error.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

if (require.main === module) {
  main();
}
