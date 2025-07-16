/**
 * MANAGE COLLECTION METADATA SCRIPT
 *
 * Interactive script for managing Security Rules and Indexes for BaseBase collections.
 * This script allows you to:
 * - View current collection metadata (security rules and indexes)
 * - Update security rules using Firebase Security Rules syntax
 * - Update indexes using MongoDB index syntax
 * - Choose from common templates for both rules and indexes
 * - Apply custom rules and indexes with JSON input
 *
 * Security rules determine who can read/write documents in collections.
 * Indexes improve query performance and enforce constraints.
 * Empty arrays allow all operations (rules) or no custom indexes.
 *
 * Usage: npm run manage-security-rules
 *
 * Requirements:
 * - BaseBase server running on localhost:8000
 * - Valid JWT token (use get-token script first)
 * - Existing project and collection
 */

const readline = require("readline");
const axios = require("axios");

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

async function getCollectionMetadata(projectName, collectionName, token) {
  try {
    const response = await axios.get(
      `${BASE_URL}/${projectName}/${collectionName}/_security`,
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

async function updateCollectionMetadata(
  projectName,
  collectionName,
  data,
  token
) {
  try {
    const response = await axios.put(
      `${BASE_URL}/${projectName}/${collectionName}/_security`,
      data,
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

async function main() {
  try {
    console.log("🔒 BaseBase Collection Metadata Manager\n");

    const token = await question("Enter your JWT token: ");
    const projectName = await question("Enter project name: ");
    const collectionName = await question("Enter collection name: ");

    console.log("\nWhat would you like to do?");
    console.log("1. View current collection metadata (rules & indexes)");
    console.log("2. Update security rules");
    console.log("3. Update indexes");
    console.log("4. Update both rules and indexes");

    const choice = await question("Enter your choice (1-4): ");

    if (choice === "1") {
      console.log("\n📋 Current Collection Metadata:");
      const metadata = await getCollectionMetadata(
        projectName,
        collectionName,
        token
      );
      console.log(JSON.stringify(metadata, null, 2));
    } else if (choice === "2") {
      console.log("\n📝 Security Rules Examples:");
      console.log("1. Allow all operations (empty rules)");
      console.log("2. Require authentication for all operations");
      console.log("3. Allow read for all, write for authenticated users");
      console.log("4. Custom rules");

      const ruleChoice = await question("Choose a template (1-4): ");

      let rules = [];

      if (ruleChoice === "1") {
        rules = []; // Empty rules allow all
      } else if (ruleChoice === "2") {
        rules = [
          {
            match: "/documents/{document}",
            allow: ["read", "write"],
            condition: "auth != null",
          },
        ];
      } else if (ruleChoice === "3") {
        rules = [
          {
            match: "/documents/{document}",
            allow: ["read"],
            condition: "true",
          },
          {
            match: "/documents/{document}",
            allow: ["write"],
            condition: "auth != null",
          },
        ];
      } else if (ruleChoice === "4") {
        console.log("\nEnter your custom rules as JSON:");
        const customRules = await question("Rules JSON: ");
        try {
          rules = JSON.parse(customRules);
        } catch (error) {
          throw new Error("Invalid JSON format");
        }
      } else {
        throw new Error("Invalid choice");
      }

      console.log("\n🔄 Updating security rules...");
      const result = await updateCollectionMetadata(
        projectName,
        collectionName,
        { rules },
        token
      );
      console.log("\n✅ Security rules updated successfully:");
      console.log(JSON.stringify(result, null, 2));
    } else if (choice === "3") {
      console.log("\n📝 Index Examples:");
      console.log("1. No indexes (empty array)");
      console.log("2. Unique email index");
      console.log("3. Text search index");
      console.log("4. Compound index with options");
      console.log("5. Custom indexes");

      const indexChoice = await question("Choose a template (1-5): ");

      let indexes = [];

      if (indexChoice === "1") {
        indexes = []; // No indexes
      } else if (indexChoice === "2") {
        indexes = [
          {
            fields: { email: 1 },
            options: { unique: true, name: "email_unique" },
          },
        ];
      } else if (indexChoice === "3") {
        indexes = [
          {
            fields: { title: "text", content: "text" },
            options: { name: "text_search_index" },
          },
        ];
      } else if (indexChoice === "4") {
        indexes = [
          {
            fields: { category: 1, priority: -1 },
            options: { sparse: true, name: "category_priority" },
          },
        ];
      } else if (indexChoice === "5") {
        console.log("\nEnter your custom indexes as JSON:");
        const customIndexes = await question("Indexes JSON: ");
        try {
          indexes = JSON.parse(customIndexes);
        } catch (error) {
          throw new Error("Invalid JSON format");
        }
      } else {
        throw new Error("Invalid choice");
      }

      console.log("\n🔄 Updating indexes...");
      const result = await updateCollectionMetadata(
        projectName,
        collectionName,
        { indexes },
        token
      );
      console.log("\n✅ Indexes updated successfully:");
      console.log(JSON.stringify(result, null, 2));
    } else if (choice === "4") {
      console.log("\n📝 Updating both rules and indexes...");
      console.log("\nFirst, enter security rules:");
      const rulesInput = await question(
        "Rules JSON (or press Enter for empty): "
      );

      let rules = [];
      if (rulesInput.trim()) {
        try {
          rules = JSON.parse(rulesInput);
        } catch (error) {
          throw new Error("Invalid rules JSON format");
        }
      }

      console.log("\nNext, enter indexes:");
      const indexesInput = await question(
        "Indexes JSON (or press Enter for empty): "
      );

      let indexes = [];
      if (indexesInput.trim()) {
        try {
          indexes = JSON.parse(indexesInput);
        } catch (error) {
          throw new Error("Invalid indexes JSON format");
        }
      }

      console.log("\n🔄 Updating both rules and indexes...");
      const result = await updateCollectionMetadata(
        projectName,
        collectionName,
        { rules, indexes },
        token
      );
      console.log("\n✅ Collection metadata updated successfully:");
      console.log(JSON.stringify(result, null, 2));
    } else {
      throw new Error("Invalid choice");
    }
  } catch (error) {
    console.error("\n❌ Error:", error.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

if (require.main === module) {
  main();
}
