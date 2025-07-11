/**
 * CREATE PROJECT SCRIPT
 *
 * Interactive script for creating new BaseBase projects.
 * This script allows authenticated users to create new projects with:
 * - Project display name and description
 * - Automatic generation of secure API keys
 * - Proper database name sanitization
 * - Unique project validation
 *
 * The script will display the generated API key once - store it securely
 * as it cannot be retrieved again (only regenerated).
 *
 * Usage: npm run create-project
 *
 * Requirements:
 * - BaseBase server running on localhost:3000
 * - Valid JWT token (use get-token script first)
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
        ...headers,
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
    console.log("🏗️  BaseBase Project Creator");
    console.log("============================\n");

    // Get server URL (default to localhost)
    const serverUrl =
      (await prompt("Enter server URL (default: http://localhost:3000): ")) ||
      "http://localhost:3000";

    // Get JWT token
    console.log("🔑 You need a JWT token to create projects.");
    console.log('   Run "npm run get-token" to get one.\n');

    const jwtToken = await prompt("Enter JWT token: ");
    if (!jwtToken) {
      console.error("❌ JWT token is required");
      process.exit(1);
    }

    // Get project details
    const projectName = await prompt("Enter project name: ");
    if (!projectName) {
      console.error("❌ Project name is required");
      process.exit(1);
    }

    const projectDescription = await prompt(
      "Enter project description (optional): "
    );

    console.log("\n🏗️  Creating project...");

    // Create project
    const projectData = JSON.stringify({
      name: projectName,
      description: projectDescription || "",
    });

    const createResponse = await makeRequest(
      `${serverUrl}/projects`,
      "POST",
      projectData,
      { Authorization: `Bearer ${jwtToken}` }
    );

    if (createResponse.statusCode !== 201) {
      console.error("❌ Failed to create project:", createResponse.data.error);
      process.exit(1);
    }

    console.log("\n✅ Project created successfully!");
    console.log("==================================");
    console.log(`📁 Project: ${createResponse.data.project.displayName}`);
    console.log(`🗃️  Database Name: ${createResponse.data.project.name}`);
    console.log(`📝 Description: ${createResponse.data.project.description}`);
    console.log(`🆔 ID: ${createResponse.data.project.id}`);
    console.log("==================================");
    console.log("\n🔑 API Key:");
    console.log(createResponse.data.apiKey);
    console.log("\n⚠️  IMPORTANT: Store this API key securely!");
    console.log("   It cannot be retrieved again, only regenerated.");
    console.log(
      "\n💡 Use this API key in your applications to authenticate with this project."
    );
    console.log(
      `   Database operations will use: ${createResponse.data.project.name}`
    );

    // Ask if user wants to list all projects
    const listProjects = await prompt(
      "\nWould you like to list all your projects? (y/n): "
    );

    if (listProjects.toLowerCase() === "y") {
      console.log("\n📋 Listing all projects...");

      const listResponse = await makeRequest(
        `${serverUrl}/projects`,
        "GET",
        null,
        { Authorization: `Bearer ${jwtToken}` }
      );

      if (listResponse.statusCode === 200) {
        console.log("\n📁 Your Projects:");
        console.log("================");

        if (listResponse.data.projects.length === 0) {
          console.log("No projects found.");
        } else {
          listResponse.data.projects.forEach((project, index) => {
            console.log(`${index + 1}. ${project.displayName}`);
            console.log(`   ID: ${project.id}`);
            console.log(`   Database Name: ${project.name}`);
            console.log(
              `   Description: ${project.description || "No description"}`
            );
            console.log(
              `   Created: ${new Date(project.createdAt).toLocaleString()}`
            );
            console.log("   API Key: [Hidden for security]");
            console.log("");
          });
        }

        console.log(`Total projects: ${listResponse.data.count}`);
      } else {
        console.error("❌ Failed to list projects:", listResponse.data.error);
      }
    }
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
