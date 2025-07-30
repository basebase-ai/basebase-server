#!/usr/bin/env node

/**
 * Test script for /create-service endpoint
 * Usage: node scripts/test-create-service.js
 */

const readline = require("readline");
const axios = require("axios");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function main() {
  try {
    console.log(
      "🚀 Testing Railway Service Creation with Deployment & Domain\n"
    );

    // Get JWT token
    const jwt = await question("Enter your JWT token: ");
    console.log("\x1b[2K\r"); // Clear the line for security

    // Get project details
    const projectId = await question("Enter project ID (must exist in DB): ");

    console.log("\n📡 Making request to Railway...");
    console.log("⚠️  Note: Project must already exist in database!");

    const response = await axios.post(
      "http://localhost:8000/v1/create-service",
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

    console.log(
      "\n✅ Success! Railway service created with deployment and domain:"
    );
    console.log(JSON.stringify(response.data, null, 2));

    if (response.data.success) {
      console.log("\n🎯 What happened:");
      console.log(
        `1. ✅ Created Railway service: ${response.data.service.name}`
      );
      console.log(
        `2. ✅ Triggered deployment: ${response.data.service.deploymentId}`
      );
      console.log(
        `3. ✅ Created custom domain: ${response.data.service.domain}`
      );
      console.log(
        `4. 🌐 Your app will be available at: ${response.data.service.deploymentUrl}`
      );
      console.log(
        "\n⏳ Deployment is in progress. Check Railway dashboard for status."
      );
    }
  } catch (error) {
    console.error("\n❌ Error:", error.response?.data || error.message);

    if (error.response?.data?.details) {
      console.error("\n🔍 Details:", error.response.data.details);
    }
  } finally {
    rl.close();
  }
}

main();
