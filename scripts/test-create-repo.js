#!/usr/bin/env node

/**
 * Test script for /create-repo endpoint
 * Usage: node scripts/test-create-repo.js
 */

const readline = require("readline");
const axios = require("axios");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt(question) {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

async function testCreateRepo() {
  try {
    console.log("🧪 Testing /create-repo endpoint\n");

    // Get inputs
    const jwt = await prompt("Enter your JWT token: ");
    const projectId = await prompt("Enter project ID (must exist in DB): ");

    console.log("\n📤 Sending request...");
    console.log("⚠️  Note: Project must already exist in database!");
    console.log("⚠️  Note: Using GitHub token from environment variables");

    const response = await axios.post(
      "http://localhost:8000/v1/create-repo",
      {
        projectId,
      },
      {
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("\n✅ Success!");
    console.log("📋 Response:");
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error("\n❌ Error:");
    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Data:", error.response.data);
    } else {
      console.error("Message:", error.message);
    }
  } finally {
    rl.close();
  }
}

testCreateRepo();
