/**
 * TEST TWILIO SMS SCRIPT
 *
 * This script demonstrates the Twilio SMS functionality by calling the sendSms function.
 * It shows how the basebase/sendSms() function now works with real Twilio integration.
 *
 * Usage: node scripts/test-twilio.js
 *
 * Requirements:
 * - BaseBase server running on localhost:8000
 * - Valid JWT token
 * - Twilio credentials configured in .env file
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
function makeRequest(url, method, data, headers = {}) {
  return new Promise((resolve) => {
    const isHttps = url.startsWith("https://");
    const requestModule = isHttps ? https : http;

    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: method,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": data ? Buffer.byteLength(data) : 0,
        ...headers,
      },
    };

    const req = requestModule.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        try {
          resolve({
            statusCode: res.statusCode,
            data: JSON.parse(body),
          });
        } catch (parseError) {
          resolve({
            statusCode: res.statusCode,
            data: { error: "Invalid JSON response", raw: body },
          });
        }
      });
    });

    req.on("error", (error) => {
      resolve({
        statusCode: 0,
        data: { error: error.message },
      });
    });

    if (data) {
      req.write(data);
    }
    req.end();
  });
}

async function main() {
  try {
    console.log("📱 BaseBase Twilio SMS Test");
    console.log("===========================\n");

    // Get server URL (default to localhost)
    const serverUrl =
      (await prompt("Enter server URL (default: http://localhost:8000): ")) ||
      "http://localhost:8000";

    // Get JWT token
    console.log("🔑 You need a JWT token to call functions.");
    console.log('   Run "npm run get-token" to get one.\n');

    const jwtToken = await prompt("Enter JWT token: ");
    if (!jwtToken) {
      console.error("❌ JWT token is required");
      process.exit(1);
    }

    // Get project ID
    const projectId =
      (await prompt(
        "Enter project ID (or leave empty for 'test-project'): "
      )) || "test-project";

    // Get SMS details
    const phoneNumber = await prompt(
      "Enter phone number to send SMS to (e.g., +1234567890): "
    );
    if (!phoneNumber) {
      console.error("❌ Phone number is required");
      process.exit(1);
    }

    const message = await prompt("Enter message to send: ");
    if (!message) {
      console.error("❌ Message is required");
      process.exit(1);
    }

    console.log("\n📱 Sending SMS via basebase/sendSms function...");

    // Call the sendSms function
    const functionData = JSON.stringify({
      data: {
        to: phoneNumber,
        message: message,
      },
    });

    const response = await makeRequest(
      `${serverUrl}/v1/projects/${projectId}/tasks/sendSms:do`,
      "POST",
      functionData,
      { Authorization: `Bearer ${jwtToken}` }
    );

    console.log("\n📊 Response:");
    console.log("=============");
    console.log(`Status: ${response.statusCode}`);
    console.log(`Response:`, JSON.stringify(response.data, null, 2));

    if (response.statusCode === 200 && response.data.success) {
      if (response.data.result.sid) {
        console.log("\n✅ SMS sent successfully via Twilio!");
        console.log(`📱 Twilio Message SID: ${response.data.result.sid}`);
      } else {
        console.log(
          "\n⚠️  SMS function executed (mock mode - Twilio not configured)"
        );
      }
    } else {
      console.log("\n❌ SMS sending failed");
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
  } finally {
    rl.close();
  }
}

main();
