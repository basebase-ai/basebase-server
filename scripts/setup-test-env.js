#!/usr/bin/env node

/**
 * Script to set up test environment variables
 */

const fs = require("fs");
const path = require("path");

const testEnvContent = `# Test Environment Configuration
NODE_ENV=test
PORT=3001
MONGODB_URI=mongodb://localhost:27017
JWT_SECRET=test-jwt-secret-key-for-automated-testing
TWILIO_ACCOUNT_SID=test_account_sid
TWILIO_AUTH_TOKEN=test_auth_token
TWILIO_PHONE_NUMBER=+1234567890
`;

const envTestPath = path.join(__dirname, "..", ".env.test");

try {
  fs.writeFileSync(envTestPath, testEnvContent);
  console.log("✅ Created .env.test file for testing");
  console.log("📁 Location:", envTestPath);
} catch (error) {
  console.error("❌ Failed to create .env.test file:", error.message);
  console.log("💡 Please create the file manually with the following content:");
  console.log(testEnvContent);
}
