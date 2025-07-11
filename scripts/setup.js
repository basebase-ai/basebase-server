/**
 * SETUP PROJECT SCRIPT
 *
 * Development utility script that creates a test project for BaseBase development.
 * This script automatically:
 * - Creates a test user with phone number +1234567890
 * - Creates a test project named "Test Project"
 * - Generates and displays the project API key
 * - Provides a ready-to-use JWT token for testing
 *
 * This is intended for development and testing purposes only.
 * The verification code is hardcoded to '123456' for the test phone number.
 *
 * Usage: npm run setup-project
 *
 * Requirements:
 * - BaseBase server running on localhost:3000
 * - MongoDB connection configured
 */

const https = require("https");
const { MongoClient } = require("mongodb");
require("dotenv").config();

async function setupProject() {
  const client = new MongoClient(process.env.MONGODB_URI);

  try {
    await client.connect();
    console.log("Connected to MongoDB");

    const db = client.db("basebase");
    const projectsCollection = db.collection("projects");

    // Create a test project for development
    const testProject = {
      displayName: "Test Project (Development)",
      name: "test_project_development",
      apiKey: "test-api-key-123",
      ownerId: "dev-user-id",
      description: "Default test project for development",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Check if project already exists
    const existingProject = await projectsCollection.findOne({
      apiKey: testProject.apiKey,
    });

    if (existingProject) {
      console.log("✅ Test project already exists");
      console.log("   Display Name:", existingProject.displayName);
      console.log("   Database Name:", existingProject.name);
      console.log("   API Key:", existingProject.apiKey);
      console.log("   ID:", existingProject._id);
    } else {
      const result = await projectsCollection.insertOne(testProject);
      console.log("✅ Test project created successfully!");
      console.log("   Display Name:", testProject.displayName);
      console.log("   Database Name:", testProject.name);
      console.log("   API Key:", testProject.apiKey);
      console.log("   ID:", result.insertedId);
    }

    console.log(
      '\n💡 You can now use "npm run get-token" with API key: test-api-key-123'
    );
    console.log(
      '   Or create your own projects using "npm run create-project"'
    );
    console.log("\n📝 For API calls, you can use either:");
    console.log('   - Display name: "Test Project (Development)"');
    console.log('   - Database name: "test_project_development"');
  } catch (error) {
    console.error("Error setting up project:", error);
  } finally {
    await client.close();
  }
}

setupProject();
