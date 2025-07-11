/**
 * MANAGE SECURITY RULES SCRIPT
 *
 * Interactive script for managing Firebase Security Rules for BaseBase collections.
 * This script allows you to:
 * - View current security rules for any collection
 * - Update security rules using Firebase Security Rules syntax
 * - Choose from common rule templates (allow all, auth required, etc.)
 * - Apply custom security rules with JSON input
 *
 * Security rules determine who can read/write documents in collections.
 * Empty rules arrays allow all operations by everyone.
 *
 * Usage: npm run manage-security-rules
 *
 * Requirements:
 * - BaseBase server running on localhost:3000
 * - Valid JWT token (use get-token script first)
 * - Existing project and collection
 */

const readline = require("readline");
const axios = require("axios");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const BASE_URL = "http://localhost:3000";

async function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer);
    });
  });
}

async function getSecurityRules(projectName, collectionName, token) {
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

async function updateSecurityRules(projectName, collectionName, rules, token) {
  try {
    const response = await axios.put(
      `${BASE_URL}/${projectName}/${collectionName}/_security`,
      {
        rules: rules,
      },
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
    console.log("🔒 BaseBase Security Rules Manager\n");

    const token = await question("Enter your JWT token: ");
    const projectName = await question("Enter project name: ");
    const collectionName = await question("Enter collection name: ");

    console.log("\nWhat would you like to do?");
    console.log("1. View current security rules");
    console.log("2. Update security rules");

    const choice = await question("Enter your choice (1-2): ");

    if (choice === "1") {
      console.log("\n📋 Current Security Rules:");
      const rules = await getSecurityRules(projectName, collectionName, token);
      console.log(JSON.stringify(rules, null, 2));
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
      const result = await updateSecurityRules(
        projectName,
        collectionName,
        rules,
        token
      );
      console.log("\n✅ Security rules updated successfully:");
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
