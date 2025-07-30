#!/usr/bin/env node

/**
 * Test script for /create-project endpoint
 * Usage: node scripts/test-create-project.js
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

async function testCreateProject() {
  try {
    console.log("🧪 Testing /create-project endpoint\n");

    // Get inputs
    const jwt = await prompt("Enter your JWT token: ");
    const projectId = await prompt(
      "Enter project ID (lowercase, hyphens allowed): "
    );
    const name = await prompt("Enter project name: ");
    const description = await prompt("Enter project description: ");
    const categories = (await prompt("Enter categories (comma-separated): "))
      .split(",")
      .map((c) => c.trim());

    console.log("\n📤 Sending request...");

    const response = await axios.post(
      "http://localhost:8000/v1/create-project",
      {
        projectId,
        name,
        description,
        categories,
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

testCreateProject();
