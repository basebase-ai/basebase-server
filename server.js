require("dotenv").config();
const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");
const cors = require("cors");
const { authenticateToken, setupAuthRoutes } = require("./auth");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB connection
let mongoClient;
let isConnected = false;

async function connectToMongoDB() {
  try {
    mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    isConnected = true;
    console.log("Connected to MongoDB Atlas");
  } catch (error) {
    console.error("MongoDB connection error:", error);
    process.exit(1);
  }
}

// Middleware to check DB connection
function checkConnection(req, res, next) {
  if (!isConnected) {
    return res.status(503).json({ error: "Database connection not available" });
  }
  next();
}

// Helper function to get database and collection
function getDbAndCollection(projectName, collectionName) {
  const db = mongoClient.db(projectName);
  const collection = db.collection(collectionName);
  return { db, collection };
}

// Helper function to resolve project name to database name
async function resolveProjectDatabaseName(projectName) {
  const projectsCollection = mongoClient.db("basebase").collection("projects");

  // First try to find by database name (exact match)
  let project = await projectsCollection.findOne({
    name: projectName,
  });

  if (!project) {
    throw new Error(`Project '${projectName}' not found`);
  }

  return project.name;
}

// Helper function to check if database/collection exists
async function checkDbCollectionExists(projectName, collectionName) {
  const adminDb = mongoClient.db().admin();
  const databases = await adminDb.listDatabases();
  const dbExists = databases.databases.some((db) => db.name === projectName);

  if (!dbExists) {
    return { dbExists: false, collectionExists: false };
  }

  const db = mongoClient.db(projectName);
  const collections = await db
    .listCollections({ name: collectionName })
    .toArray();
  const collectionExists = collections.length > 0;

  return { dbExists, collectionExists };
}

// Helper function to validate creation permissions
async function validateCreationPermissions(
  requestedProjectName,
  userProjectName,
  collectionName
) {
  const { dbExists, collectionExists } = await checkDbCollectionExists(
    requestedProjectName,
    collectionName
  );

  // If database doesn't exist, only allow creation if it matches user's project
  if (!dbExists && requestedProjectName !== userProjectName) {
    throw new Error(
      `Cannot create database '${requestedProjectName}' - only databases matching your project name '${userProjectName}' can be created`
    );
  }

  // If database exists but collection doesn't, only allow creation in user's project database
  if (
    dbExists &&
    !collectionExists &&
    requestedProjectName !== userProjectName
  ) {
    throw new Error(
      `Cannot create collection '${collectionName}' in database '${requestedProjectName}' - collections can only be created in your project database '${userProjectName}'`
    );
  }

  return { dbExists, collectionExists };
}

// Helper function to initialize security rules for a new collection
async function initializeSecurityRules(projectName, collectionName) {
  try {
    const securityRulesCollection = mongoClient
      .db("basebase")
      .collection("security_rules");

    // Check if rules already exist for this collection
    const existingRules = await securityRulesCollection.findOne({
      projectName: projectName,
      collectionName: collectionName,
    });

    if (existingRules) {
      console.log(
        `Security rules already exist for ${projectName}/${collectionName}`
      );
      return;
    }

    // Create default security rules document
    const defaultRules = {
      projectName: projectName,
      collectionName: collectionName,
      rules: [], // Empty rules array allows all operations for now
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await securityRulesCollection.insertOne(defaultRules);
    console.log(
      `Created default security rules for ${projectName}/${collectionName}`
    );
  } catch (error) {
    console.error(
      `Failed to initialize security rules for ${projectName}/${collectionName}:`,
      error
    );
    // Don't throw error - security rules initialization shouldn't block collection creation
  }
}

// Helper function to convert Firestore-style document to MongoDB format
function convertFromFirestoreFormat(firestoreDoc) {
  if (!firestoreDoc.fields) {
    return firestoreDoc;
  }

  const mongoDoc = {};
  for (const [key, value] of Object.entries(firestoreDoc.fields)) {
    if (value.stringValue !== undefined) {
      mongoDoc[key] = value.stringValue;
    } else if (value.integerValue !== undefined) {
      mongoDoc[key] = parseInt(value.integerValue);
    } else if (value.doubleValue !== undefined) {
      mongoDoc[key] = parseFloat(value.doubleValue);
    } else if (value.booleanValue !== undefined) {
      mongoDoc[key] = value.booleanValue;
    } else if (value.nullValue !== undefined) {
      mongoDoc[key] = null;
    } else {
      mongoDoc[key] = value;
    }
  }
  return mongoDoc;
}

// Helper function to convert MongoDB document to Firestore-style format
function convertToFirestoreFormat(mongoDoc) {
  const firestoreDoc = { fields: {} };

  for (const [key, value] of Object.entries(mongoDoc)) {
    if (key === "_id") {
      firestoreDoc.name = value.toString();
      continue;
    }

    if (typeof value === "string") {
      firestoreDoc.fields[key] = { stringValue: value };
    } else if (typeof value === "number") {
      if (Number.isInteger(value)) {
        firestoreDoc.fields[key] = { integerValue: value.toString() };
      } else {
        firestoreDoc.fields[key] = { doubleValue: value };
      }
    } else if (typeof value === "boolean") {
      firestoreDoc.fields[key] = { booleanValue: value };
    } else if (value === null) {
      firestoreDoc.fields[key] = { nullValue: null };
    } else {
      firestoreDoc.fields[key] = value;
    }
  }

  return firestoreDoc;
}

// CRUD ENDPOINTS (JWT required)

// CREATE - POST document (auto-generated ObjectId only)
app.post(
  "/:projectName/:collectionName",
  checkConnection,
  authenticateToken,
  async (req, res) => {
    try {
      const { projectName, collectionName } = req.params;

      console.log(`[CREATE] POST /${projectName}/${collectionName}`);
      console.log(
        `[CREATE] User: ${req.user.userId}, Project: ${req.user.projectName}`
      );
      console.log(`[CREATE] Body:`, req.body);

      // Use project name from JWT (already sanitized) for permission checks
      const userProjectName = req.user.projectName;

      // Resolve the requested project name to database name
      let targetDbName;
      try {
        targetDbName = await resolveProjectDatabaseName(projectName);
      } catch (resolveError) {
        console.error(`[CREATE] Project resolution failed:`, resolveError);
        return res.status(404).json({
          error: resolveError.message,
          suggestion: `Make sure the project '${projectName}' exists and you have access to it.`,
        });
      }

      // Validate creation permissions - prevents creating databases/collections outside user's project
      let validationResult;
      try {
        validationResult = await validateCreationPermissions(
          targetDbName,
          userProjectName,
          collectionName
        );
      } catch (validationError) {
        console.error(
          `[CREATE] Permission validation failed:`,
          validationError
        );
        return res.status(403).json({
          error: validationError.message,
          suggestion: `You can only create documents in collections within your project '${userProjectName}'.`,
        });
      }

      const { collection } = getDbAndCollection(targetDbName, collectionName);
      const document = convertFromFirestoreFormat(req.body);

      // Always use auto-generated ObjectId
      const result = await collection.insertOne(document);

      // Initialize security rules if this is a new collection
      if (!validationResult.collectionExists) {
        await initializeSecurityRules(targetDbName, collectionName);
      }

      const insertedDoc = await collection.findOne({ _id: result.insertedId });
      console.log(
        `[CREATE] Successfully created document with ID ${result.insertedId} in ${targetDbName}/${collectionName}`
      );
      res.status(201).json(convertToFirestoreFormat(insertedDoc));
    } catch (error) {
      console.error(`[CREATE] Error creating document:`, error);

      res.status(500).json({
        error: "Failed to create document",
        suggestion:
          "Check your document structure and try again. Contact support if the problem persists.",
      });
    }
  }
);

// READ - GET single document
app.get(
  "/:projectName/:collectionName/:documentId",
  checkConnection,
  authenticateToken,
  async (req, res) => {
    try {
      const { projectName, collectionName, documentId } = req.params;

      console.log(`[READ] GET /${projectName}/${collectionName}/${documentId}`);
      console.log(
        `[READ] User: ${req.user.userId}, Project: ${req.user.projectName}`
      );

      // Resolve the requested project name to database name
      let targetDbName;
      try {
        targetDbName = await resolveProjectDatabaseName(projectName);
      } catch (resolveError) {
        console.error(`[READ] Project resolution failed:`, resolveError);
        return res.status(404).json({
          error: resolveError.message,
          suggestion: `Make sure the project '${projectName}' exists and you have access to it.`,
        });
      }

      const { collection } = getDbAndCollection(targetDbName, collectionName);

      const document = await collection.findOne({
        _id: new ObjectId(documentId),
      });

      if (!document) {
        console.log(
          `[READ] Document not found: ${documentId} in ${targetDbName}/${collectionName}`
        );
        return res.status(404).json({
          error: "Document not found",
          suggestion: `Check that the document ID '${documentId}' exists in collection '${collectionName}'.`,
        });
      }

      console.log(
        `[READ] Successfully retrieved document ${documentId} from ${targetDbName}/${collectionName}`
      );
      res.json(convertToFirestoreFormat(document));
    } catch (error) {
      console.error(`[READ] Error reading document:`, error);
      res.status(500).json({
        error: "Failed to read document",
        suggestion:
          "Check your document ID format and try again. Contact support if the problem persists.",
      });
    }
  }
);

// READ - GET collection
app.get(
  "/:projectName/:collectionName",
  checkConnection,
  authenticateToken,
  async (req, res) => {
    try {
      const { projectName, collectionName } = req.params;

      // Resolve the requested project name to database name
      let targetDbName;
      try {
        targetDbName = await resolveProjectDatabaseName(projectName);
      } catch (resolveError) {
        return res.status(404).json({ error: resolveError.message });
      }

      const { collection } = getDbAndCollection(targetDbName, collectionName);

      const documents = await collection.find({}).toArray();

      const firestoreDocuments = documents.map((doc) =>
        convertToFirestoreFormat(doc)
      );

      res.json({
        documents: firestoreDocuments,
      });
    } catch (error) {
      console.error("Read collection error:", error);
      res.status(500).json({ error: "Failed to read collection" });
    }
  }
);

// UPDATE - PATCH document
app.patch(
  "/:projectName/:collectionName/:documentId",
  checkConnection,
  authenticateToken,
  async (req, res) => {
    try {
      const { projectName, collectionName, documentId } = req.params;

      // Resolve the requested project name to database name
      let targetDbName;
      try {
        targetDbName = await resolveProjectDatabaseName(projectName);
      } catch (resolveError) {
        return res.status(404).json({ error: resolveError.message });
      }

      const { collection } = getDbAndCollection(targetDbName, collectionName);

      const updateData = convertFromFirestoreFormat(req.body);

      const result = await collection.updateOne(
        { _id: new ObjectId(documentId) },
        { $set: updateData }
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({ error: "Document not found" });
      }

      const updatedDoc = await collection.findOne({
        _id: new ObjectId(documentId),
      });
      res.json(convertToFirestoreFormat(updatedDoc));
    } catch (error) {
      console.error("Update error:", error);
      res.status(500).json({ error: "Failed to update document" });
    }
  }
);

// DELETE - DELETE document
app.delete(
  "/:projectName/:collectionName/:documentId",
  checkConnection,
  authenticateToken,
  async (req, res) => {
    try {
      const { projectName, collectionName, documentId } = req.params;

      // Resolve the requested project name to database name
      let targetDbName;
      try {
        targetDbName = await resolveProjectDatabaseName(projectName);
      } catch (resolveError) {
        return res.status(404).json({ error: resolveError.message });
      }

      const { collection } = getDbAndCollection(targetDbName, collectionName);

      const result = await collection.deleteOne({
        _id: new ObjectId(documentId),
      });

      if (result.deletedCount === 0) {
        return res.status(404).json({ error: "Document not found" });
      }

      res.status(204).send();
    } catch (error) {
      console.error("Delete error:", error);
      res.status(500).json({ error: "Failed to delete document" });
    }
  }
);

// SECURITY RULES MANAGEMENT ENDPOINTS

// GET security rules for a collection
app.get(
  "/:projectName/:collectionName/_security",
  checkConnection,
  authenticateToken,
  async (req, res) => {
    try {
      const { projectName, collectionName } = req.params;

      // Resolve the requested project name to database name
      let targetDbName;
      try {
        targetDbName = await resolveProjectDatabaseName(projectName);
      } catch (resolveError) {
        return res.status(404).json({ error: resolveError.message });
      }

      const securityRulesCollection = mongoClient
        .db("basebase")
        .collection("security_rules");

      const securityRules = await securityRulesCollection.findOne({
        projectName: targetDbName,
        collectionName: collectionName,
      });

      if (!securityRules) {
        return res
          .status(404)
          .json({ error: "Security rules not found for this collection" });
      }

      res.json({
        projectName: securityRules.projectName,
        collectionName: securityRules.collectionName,
        rules: securityRules.rules,
        createdAt: securityRules.createdAt,
        updatedAt: securityRules.updatedAt,
      });
    } catch (error) {
      console.error("Get security rules error:", error);
      res.status(500).json({ error: "Failed to retrieve security rules" });
    }
  }
);

// PUT security rules for a collection
app.put(
  "/:projectName/:collectionName/_security",
  checkConnection,
  authenticateToken,
  async (req, res) => {
    try {
      const { projectName, collectionName } = req.params;
      const { rules } = req.body;

      if (!Array.isArray(rules)) {
        return res.status(400).json({ error: "Rules must be an array" });
      }

      // Resolve the requested project name to database name
      let targetDbName;
      try {
        targetDbName = await resolveProjectDatabaseName(projectName);
      } catch (resolveError) {
        return res.status(404).json({ error: resolveError.message });
      }

      const securityRulesCollection = mongoClient
        .db("basebase")
        .collection("security_rules");

      const result = await securityRulesCollection.updateOne(
        {
          projectName: targetDbName,
          collectionName: collectionName,
        },
        {
          $set: {
            rules: rules,
            updatedAt: new Date(),
          },
        },
        { upsert: true }
      );

      if (result.upsertedCount > 0) {
        // If we created a new document, add the creation timestamp
        await securityRulesCollection.updateOne(
          { _id: result.upsertedId },
          { $set: { createdAt: new Date() } }
        );
      }

      const updatedRules = await securityRulesCollection.findOne({
        projectName: targetDbName,
        collectionName: collectionName,
      });

      res.json({
        projectName: updatedRules.projectName,
        collectionName: updatedRules.collectionName,
        rules: updatedRules.rules,
        createdAt: updatedRules.createdAt,
        updatedAt: updatedRules.updatedAt,
      });
    } catch (error) {
      console.error("Update security rules error:", error);
      res.status(500).json({ error: "Failed to update security rules" });
    }
  }
);

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    connected: isConnected,
    timestamp: new Date().toISOString(),
  });
});

// 404 handler - must be after all other routes
app.use((req, res) => {
  console.log(`[404] ${req.method} ${req.path} - Route not found`);
  console.log(`[404] Available routes for data operations:`);
  console.log(
    `  POST /${req.params.projectName || "[projectName]"}/${
      req.params.collectionName || "[collectionName]"
    } - Create document (auto-generated ID)`
  );
  console.log(
    `  GET /${req.params.projectName || "[projectName]"}/${
      req.params.collectionName || "[collectionName]"
    } - Get all documents`
  );
  console.log(
    `  GET /${req.params.projectName || "[projectName]"}/${
      req.params.collectionName || "[collectionName]"
    }/[documentId] - Get specific document`
  );
  console.log(
    `  PATCH /${req.params.projectName || "[projectName]"}/${
      req.params.collectionName || "[collectionName]"
    }/[documentId] - Update document`
  );
  console.log(
    `  DELETE /${req.params.projectName || "[projectName]"}/${
      req.params.collectionName || "[collectionName]"
    }/[documentId] - Delete document`
  );

  res.status(404).json({
    error: "Route not found",
    method: req.method,
    path: req.path,
    suggestion: getRouteSuggestion(req.method, req.path),
    availableRoutes: {
      create: "POST /:projectName/:collectionName (auto-generated ID)",
      read: "GET /:projectName/:collectionName or GET /:projectName/:collectionName/:documentId",
      update: "PATCH /:projectName/:collectionName/:documentId",
      delete: "DELETE /:projectName/:collectionName/:documentId",
      auth: "POST /requestCode, POST /verifyCode",
      projects: "GET /projects, POST /projects",
    },
  });
});

// Helper function to provide route suggestions
function getRouteSuggestion(method, path) {
  const pathParts = path.split("/").filter((part) => part);

  if (method === "POST" && pathParts.length === 3) {
    return `Custom document IDs are not supported. To create a document in collection '${pathParts[1]}' of project '${pathParts[0]}' with auto-generated ID, use: POST /${pathParts[0]}/${pathParts[1]}`;
  } else if (method === "POST" && pathParts.length === 2) {
    return `To create a document in collection '${pathParts[1]}' of project '${pathParts[0]}' with auto-generated ID, use: POST /${pathParts[0]}/${pathParts[1]}`;
  } else if (method === "GET" && pathParts.length === 3) {
    return `To get document '${pathParts[2]}' from collection '${pathParts[1]}' of project '${pathParts[0]}', use: GET /${pathParts[0]}/${pathParts[1]}/${pathParts[2]}`;
  } else if (method === "GET" && pathParts.length === 2) {
    return `To get all documents from collection '${pathParts[1]}' of project '${pathParts[0]}', use: GET /${pathParts[0]}/${pathParts[1]}`;
  }

  return `Check the available routes listed above for the correct API endpoint format.`;
}

// Global error handler
app.use((error, req, res, next) => {
  console.error(`[ERROR] ${req.method} ${req.path}:`, error);

  if (error.name === "ValidationError") {
    return res.status(400).json({
      error: "Validation failed",
      details: error.message,
      suggestion: "Check your request data format and required fields.",
    });
  }

  if (error.name === "MongoError" || error.name === "MongoServerError") {
    return res.status(500).json({
      error: "Database error",
      suggestion:
        "There was an issue with the database operation. Please try again.",
    });
  }

  res.status(500).json({
    error: "Internal server error",
    suggestion:
      "An unexpected error occurred. Please try again or contact support.",
  });
});

// Start server
async function startServer() {
  await connectToMongoDB();

  // Setup authentication routes after MongoDB connection
  setupAuthRoutes(app, mongoClient, checkConnection);

  app.listen(PORT, () => {
    console.log(`BaseBase Server running on port ${PORT}`);
  });
}

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down server...");
  if (mongoClient) {
    await mongoClient.close();
  }
  process.exit(0);
});

startServer().catch(console.error);
