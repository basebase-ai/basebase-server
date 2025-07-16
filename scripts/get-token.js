/**
 * GET TOKEN SCRIPT
 *
 * Interactive script for generating JWT tokens for BaseBase API authentication.
 * This script guides you through the phone verification process:
 * 1. Requests a verification code for your phone number
 * 2. Prompts you to enter the received code
 * 3. Returns a JWT token that can be used for API authentication
 *
 * Usage: npm run get-token
 *
 * Requirements:
 * - BaseBase server running on localhost:8000
 * - Valid project API key
 * - Phone number capable of receiving SMS
 */

const readline = require("readline");
const https = require("https");
const http = require("http");

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Helper function to prompt user
function prompt(question) {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

// Helper function to make HTTP requests
function makeRequest(url, method, data) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const requestModule = urlObj.protocol === "https:" ? https : http;

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === "https:" ? 443 : 80),
      path: urlObj.pathname,
      method: method,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": data ? Buffer.byteLength(data) : 0,
      },
    };

    const req = requestModule.request(options, (res) => {
      let responseData = "";

      res.on("data", (chunk) => {
        responseData += chunk;
      });

      res.on("end", () => {
        try {
          const parsedData = JSON.parse(responseData);
          resolve({ statusCode: res.statusCode, data: parsedData });
        } catch (error) {
          reject(new Error(`Failed to parse response: ${error.message}`));
        }
      });
    });

    req.on("error", (error) => {
      reject(error);
    });

    if (data) {
      req.write(data);
    }

    req.end();
  });
}

async function main() {
  try {
    console.log("🔐 BaseBase Authentication Token Generator");
    console.log("==========================================\n");

    // Get server URL (default to localhost)
    const serverUrl =
      (await prompt("Enter server URL (default: http://localhost:8000): ")) ||
      "http://localhost:8000";

    // Get project API key
    console.log("💡 You need a project API key to authenticate.");
    console.log(
      "   Create a project first using the API or use an existing one."
    );
    console.log("   Default test API key: test-api-key-123\n");

    const projectApiKey = await prompt("Enter project API key: ");
    if (!projectApiKey) {
      console.error("❌ Project API key is required");
      process.exit(1);
    }

    // Get user name
    const name = await prompt("Enter your name: ");
    if (!name) {
      console.error("❌ Name is required");
      process.exit(1);
    }

    // Get phone number
    const phone = await prompt("Enter your phone number (e.g., +1234567890): ");
    if (!phone) {
      console.error("❌ Phone number is required");
      process.exit(1);
    }

    console.log("\n📱 Requesting verification code...");

    // Step 1: Request verification code
    const requestCodeData = JSON.stringify({
      username: name,
      phone: phone,
    });

    const codeResponse = await makeRequest(
      `${serverUrl}/requestCode`,
      "POST",
      requestCodeData
    );

    if (codeResponse.statusCode !== 200) {
      console.error(
        "❌ Failed to request verification code:",
        codeResponse.data.error
      );
      process.exit(1);
    }

    console.log("✅ Verification code sent!");
    if (codeResponse.data.code) {
      console.log(`📝 Development code: ${codeResponse.data.code}`);
    }

    // Get verification code from user
    const code = await prompt("\nEnter verification code: ");
    if (!code) {
      console.error("❌ Verification code is required");
      process.exit(1);
    }

    console.log("\n🔑 Verifying code and getting JWT token...");

    // Step 2: Verify code and get JWT
    const verifyCodeData = JSON.stringify({
      phone: phone,
      code: code,
      projectApiKey: projectApiKey,
    });

    const tokenResponse = await makeRequest(
      `${serverUrl}/verifyCode`,
      "POST",
      verifyCodeData
    );

    if (tokenResponse.statusCode !== 200) {
      console.error("❌ Failed to verify code:", tokenResponse.data.error);
      process.exit(1);
    }

    console.log("\n✅ Authentication successful!");
    console.log("==========================================");
    console.log(
      `👤 User: ${tokenResponse.data.user.name} (${tokenResponse.data.user.phone})`
    );
    console.log(`🏢 Project: ${tokenResponse.data.project.name}`);
    console.log("==========================================");
    console.log("\n🎫 JWT Token:");
    console.log(tokenResponse.data.token);
    console.log("\n📋 Copy this token and use it in your API requests as:");
    console.log("Authorization: Bearer " + tokenResponse.data.token);
    console.log("\n⏰ Token expires in 1 year");
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

// Handle Ctrl+C gracefully
process.on("SIGINT", () => {
  console.log("\n\n👋 Goodbye!");
  rl.close();
  process.exit(0);
});

main();
