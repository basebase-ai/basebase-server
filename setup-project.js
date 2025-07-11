const { MongoClient } = require("mongodb");
require("dotenv").config();

async function setupProject() {
  const client = new MongoClient(process.env.MONGODB_URI);

  try {
    await client.connect();
    console.log("Connected to MongoDB");

    const db = client.db("basebase");
    const projectsCollection = db.collection("projects");

    // Create a test project
    const testProject = {
      name: "BaseBase",
      apiKey: "basebase-api-key-123",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Check if project already exists
    const existingProject = await projectsCollection.findOne({
      apiKey: testProject.apiKey,
    });

    if (existingProject) {
      console.log("Test project already exists:", existingProject);
    } else {
      const result = await projectsCollection.insertOne(testProject);
      console.log("Test project created:", result.insertedId);

      const createdProject = await projectsCollection.findOne({
        _id: result.insertedId,
      });
      console.log("Project details:", createdProject);
    }
  } catch (error) {
    console.error("Error setting up project:", error);
  } finally {
    await client.close();
  }
}

setupProject();
