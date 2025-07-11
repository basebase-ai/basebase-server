const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");
const cors = require("cors");
const { authenticateToken, setupAuthRoutes } = require("./auth");
require("dotenv").config();

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

// CREATE - POST document
app.post(
  "/:projectName/:collectionName",
  checkConnection,
  authenticateToken,
  async (req, res) => {
    try {
      const { projectName, collectionName } = req.params;
      const { documentId } = req.query;

      // Check if database/collection exists before creating
      const { dbExists, collectionExists } = await checkDbCollectionExists(
        projectName,
        collectionName
      );

      if (!dbExists) {
        console.log(`Creating new database: ${projectName}`);
      }
      if (!collectionExists) {
        console.log(
          `Creating new collection: ${collectionName} in database: ${projectName}`
        );
      }

      const { collection } = getDbAndCollection(projectName, collectionName);
      const document = convertFromFirestoreFormat(req.body);

      let result;
      if (documentId) {
        document._id = documentId;
        result = await collection.insertOne(document);
      } else {
        result = await collection.insertOne(document);
      }

      const insertedDoc = await collection.findOne({ _id: result.insertedId });
      res.status(201).json(convertToFirestoreFormat(insertedDoc));
    } catch (error) {
      console.error("Create error:", error);
      res.status(500).json({ error: "Failed to create document" });
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
      const { collection } = getDbAndCollection(projectName, collectionName);

      const document = await collection.findOne({
        _id: new ObjectId(documentId),
      });

      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }

      res.json(convertToFirestoreFormat(document));
    } catch (error) {
      console.error("Read error:", error);
      res.status(500).json({ error: "Failed to read document" });
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
      const { collection } = getDbAndCollection(projectName, collectionName);

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
      const { collection } = getDbAndCollection(projectName, collectionName);

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
      const { collection } = getDbAndCollection(projectName, collectionName);

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

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    connected: isConnected,
    timestamp: new Date().toISOString(),
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
