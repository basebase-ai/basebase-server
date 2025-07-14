require("dotenv").config();
const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");
const crypto = require("crypto");
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

// Helper function to validate MongoDB ObjectId format
function isValidObjectId(id) {
  return /^[0-9a-fA-F]{24}$/.test(id);
}

// Helper function to generate 72-bit base64 _name ID
function generateName() {
  // Generate 9 bytes (72 bits) of random data
  const randomBytes = crypto.randomBytes(9);
  // Convert to base64 and make URL-safe
  return randomBytes.toString('base64url');
}

// Helper function to validate _name format
function isValidName(name) {
  if (!name || typeof name !== 'string') return false;
  
  // Must be URL-safe, less than 24 characters
  if (name.length >= 24) return false;
  
  // URL-safe characters: letters, numbers, hyphens, underscores
  return /^[A-Za-z0-9_-]+$/.test(name);
}

// Helper function to find document by _name or fallback to _id
function buildDocumentQuery(documentId) {
  // If it looks like an ObjectId, use _id for backward compatibility
  if (isValidObjectId(documentId)) {
    return { _id: new ObjectId(documentId) };
  }
  // Otherwise use _name field
  return { _name: documentId };
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

// Helper function to initialize collection metadata for a new collection
async function initializeCollectionMetadata(projectName, collectionName) {
  try {
    const collectionsCollection = mongoClient
      .db("basebase")
      .collection("collections");

    // Check if metadata already exists for this collection
    const existingMetadata = await collectionsCollection.findOne({
      projectName: projectName,
      collectionName: collectionName,
    });

    if (existingMetadata) {
      console.log(
        `Collection metadata already exists for ${projectName}/${collectionName}`
      );
      return;
    }

    // Create default collection metadata document
    const defaultMetadata = {
      projectName: projectName,
      collectionName: collectionName,
      rules: [], // Empty rules array allows all operations for now
      indexes: [], // Array for MongoDB-like indexes (unique, sparse, text, etc.)
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await collectionsCollection.insertOne(defaultMetadata);
    console.log(
      `Created default collection metadata for ${projectName}/${collectionName}`
    );
  } catch (error) {
    console.error(
      `Failed to initialize collection metadata for ${projectName}/${collectionName}:`,
      error
    );
    // Don't throw error - collection metadata initialization shouldn't block collection creation
  }
}

// Helper function to apply indexes from metadata to actual MongoDB collection
async function applyCollectionIndexes(projectName, collectionName) {
  try {
    console.log(
      `[INDEX] Checking indexes for ${projectName}/${collectionName}`
    );

    // Get collection metadata
    const collectionsCollection = mongoClient
      .db("basebase")
      .collection("collections");

    const metadata = await collectionsCollection.findOne({
      projectName: projectName,
      collectionName: collectionName,
    });

    if (!metadata || !metadata.indexes || metadata.indexes.length === 0) {
      console.log(
        `[INDEX] No indexes defined for ${projectName}/${collectionName}`
      );
      return;
    }

    // Get the actual MongoDB collection
    const { collection } = getDbAndCollection(projectName, collectionName);

    // Get existing indexes
    const existingIndexes = await collection.listIndexes().toArray();
    const existingIndexNames = new Set(existingIndexes.map((idx) => idx.name));

    console.log(
      `[INDEX] Existing indexes: ${Array.from(existingIndexNames).join(", ")}`
    );
    console.log(
      `[INDEX] Applying ${metadata.indexes.length} indexes from metadata`
    );

    // Apply each index from metadata
    for (const indexDef of metadata.indexes) {
      try {
        const { fields, options = {} } = indexDef;

        if (!fields || typeof fields !== "object") {
          console.warn(
            `[INDEX] Invalid index definition - missing or invalid fields:`,
            indexDef
          );
          continue;
        }

        // Generate index name if not provided
        const indexName = options.name || generateIndexName(fields);

        // Skip if index already exists
        if (existingIndexNames.has(indexName)) {
          console.log(`[INDEX] Index '${indexName}' already exists, skipping`);
          continue;
        }

        // Create the index
        console.log(
          `[INDEX] Creating index '${indexName}' with fields:`,
          fields,
          "options:",
          options
        );
        await collection.createIndex(fields, { ...options, name: indexName });
        console.log(`[INDEX] Successfully created index '${indexName}'`);
      } catch (indexError) {
        console.error(`[INDEX] Failed to create index:`, indexError.message);
        // Continue with other indexes - don't let one failure stop the rest
      }
    }
  } catch (error) {
    console.error(
      `[INDEX] Error applying indexes for ${projectName}/${collectionName}:`,
      error.message
    );
    // Don't throw error - index application shouldn't block document operations
  }
}

// Helper function to generate index name from fields
function generateIndexName(fields) {
  return Object.entries(fields)
    .map(([field, direction]) => `${field}_${direction}`)
    .join("_");
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
    if (key === "_name") {
      firestoreDoc.name = value;
      continue;
    }
    
    // Skip MongoDB _id field from output
    if (key === "_id") {
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

// CREATE - POST document (auto-generated _name ID)
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

      // Generate unique _name ID
      let documentName;
      let attempts = 0;
      const maxAttempts = 5;
      
      do {
        documentName = generateName();
        attempts++;
        
        // Check if _name already exists
        const existingDoc = await collection.findOne({ _name: documentName });
        if (!existingDoc) break;
        
        if (attempts >= maxAttempts) {
          console.error(`[CREATE] Failed to generate unique _name after ${maxAttempts} attempts`);
          return res.status(500).json({
            error: "Failed to generate unique document ID",
            suggestion: "Please try again. Contact support if the problem persists.",
          });
        }
      } while (attempts < maxAttempts);

      // Add _name to document
      document._name = documentName;

      const result = await collection.insertOne(document);

      // Initialize collection metadata if this is a new collection
      if (!validationResult.collectionExists) {
        await initializeCollectionMetadata(targetDbName, collectionName);
      }

      // Apply collection indexes after successful document creation
      await applyCollectionIndexes(targetDbName, collectionName);

      const insertedDoc = await collection.findOne({ _id: result.insertedId });
      console.log(
        `[CREATE] Successfully created document with _name ${documentName} in ${targetDbName}/${collectionName}`
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

      const collectionsCollection = mongoClient
        .db("basebase")
        .collection("collections");

      const collectionMetadata = await collectionsCollection.findOne({
        projectName: targetDbName,
        collectionName: collectionName,
      });

      if (!collectionMetadata) {
        return res
          .status(404)
          .json({ error: "Collection metadata not found for this collection" });
      }

      res.json({
        projectName: collectionMetadata.projectName,
        collectionName: collectionMetadata.collectionName,
        rules: collectionMetadata.rules,
        indexes: collectionMetadata.indexes || [],
        createdAt: collectionMetadata.createdAt,
        updatedAt: collectionMetadata.updatedAt,
      });
    } catch (error) {
      console.error("Get collection metadata error:", error);
      res.status(500).json({ error: "Failed to retrieve collection metadata" });
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
      const { rules, indexes } = req.body;

      if (rules !== undefined && !Array.isArray(rules)) {
        return res.status(400).json({ error: "Rules must be an array" });
      }

      if (indexes !== undefined && !Array.isArray(indexes)) {
        return res.status(400).json({ error: "Indexes must be an array" });
      }

      // Resolve the requested project name to database name
      let targetDbName;
      try {
        targetDbName = await resolveProjectDatabaseName(projectName);
      } catch (resolveError) {
        return res.status(404).json({ error: resolveError.message });
      }

      const collectionsCollection = mongoClient
        .db("basebase")
        .collection("collections");

      // Build update object based on provided fields
      const updateFields = { updatedAt: new Date() };
      if (rules !== undefined) {
        updateFields.rules = rules;
      }
      if (indexes !== undefined) {
        updateFields.indexes = indexes;
      }

      const result = await collectionsCollection.updateOne(
        {
          projectName: targetDbName,
          collectionName: collectionName,
        },
        {
          $set: updateFields,
        },
        { upsert: true }
      );

      if (result.upsertedCount > 0) {
        // If we created a new document, add the creation timestamp and default values
        await collectionsCollection.updateOne(
          { _id: result.upsertedId },
          {
            $set: {
              createdAt: new Date(),
              ...(rules === undefined && { rules: [] }),
              ...(indexes === undefined && { indexes: [] }),
            },
          }
        );
      }

      const updatedMetadata = await collectionsCollection.findOne({
        projectName: targetDbName,
        collectionName: collectionName,
      });

      res.json({
        projectName: updatedMetadata.projectName,
        collectionName: updatedMetadata.collectionName,
        rules: updatedMetadata.rules,
        indexes: updatedMetadata.indexes || [],
        createdAt: updatedMetadata.createdAt,
        updatedAt: updatedMetadata.updatedAt,
      });
    } catch (error) {
      console.error("Update collection metadata error:", error);
      res.status(500).json({ error: "Failed to update collection metadata" });
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

      // Build query to find document by _name or _id (for backward compatibility)
      const query = buildDocumentQuery(documentId);
      const document = await collection.findOne(query);

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
      
      // Prevent modification of _name field
      if (updateData._name !== undefined) {
        return res.status(400).json({
          error: "Cannot modify _name field",
          suggestion: "The _name field is immutable. Use PUT to replace the entire document or create a new document with a different _name.",
        });
      }
      
      // Build query to find document by _name or _id (for backward compatibility)
      const query = buildDocumentQuery(documentId);

      const result = await collection.updateOne(
        query,
        { $set: updateData }
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({ error: "Document not found" });
      }

      // Apply collection indexes after successful document update
      await applyCollectionIndexes(targetDbName, collectionName);

      const updatedDoc = await collection.findOne(query);
      res.json(convertToFirestoreFormat(updatedDoc));
    } catch (error) {
      console.error("Update error:", error);
      res.status(500).json({ error: "Failed to update document" });
    }
  }
);

// SET - PUT document (create or replace with specific _name ID)
app.put(
  "/:projectName/:collectionName/:documentId",
  checkConnection,
  authenticateToken,
  async (req, res) => {
    try {
      const { projectName, collectionName, documentId } = req.params;

      console.log(`[SET] PUT /${projectName}/${collectionName}/${documentId}`);
      console.log(
        `[SET] User: ${req.user.userId}, Project: ${req.user.projectName}`
      );
      console.log(`[SET] Body:`, req.body);

      // Validate _name format (allow ObjectId for backward compatibility)
      if (!isValidObjectId(documentId) && !isValidName(documentId)) {
        console.error(`[SET] Invalid document ID format: ${documentId}`);
        return res.status(400).json({
          error: "Invalid document ID format",
          suggestion:
            "Document ID must be URL-safe, less than 24 characters, or a 24-character hexadecimal ObjectId for backward compatibility",
        });
      }

      // Use project name from JWT (already sanitized) for permission checks
      const userProjectName = req.user.projectName;

      // Resolve the requested project name to database name
      let targetDbName;
      try {
        targetDbName = await resolveProjectDatabaseName(projectName);
      } catch (resolveError) {
        console.error(`[SET] Project resolution failed:`, resolveError);
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
        console.error(`[SET] Permission validation failed:`, validationError);
        return res.status(403).json({
          error: validationError.message,
          suggestion: `You can only create documents in collections within your project '${userProjectName}'.`,
        });
      }

      const { collection } = getDbAndCollection(targetDbName, collectionName);
      const document = convertFromFirestoreFormat(req.body);

      // Build query for finding existing document
      const query = buildDocumentQuery(documentId);
      
      // For new documents with _name, ensure _name is set in document
      if (!isValidObjectId(documentId)) {
        document._name = documentId;
      }

      // Use replaceOne with upsert to implement set behavior
      const result = await collection.replaceOne(
        query,
        document,
        { upsert: true }
      );

      // Initialize collection metadata if this is a new collection
      if (!validationResult.collectionExists) {
        await initializeCollectionMetadata(targetDbName, collectionName);
      }

      // Apply collection indexes after successful document operation
      await applyCollectionIndexes(targetDbName, collectionName);

      const setDoc = await collection.findOne(query);

      if (result.upsertedCount > 0) {
        console.log(
          `[SET] Successfully created document with ID ${documentId} in ${targetDbName}/${collectionName}`
        );
      } else {
        console.log(
          `[SET] Successfully replaced document with ID ${documentId} in ${targetDbName}/${collectionName}`
        );
      }

      res.status(200).json(convertToFirestoreFormat(setDoc));
    } catch (error) {
      console.error(`[SET] Error setting document:`, error);

      res.status(500).json({
        error: "Failed to set document",
        suggestion:
          "Check your document structure and ID format. Contact support if the problem persists.",
      });
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

      // Build query to find document by _name or _id (for backward compatibility)
      const query = buildDocumentQuery(documentId);
      const result = await collection.deleteOne(query);

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

// Helper function to provide route suggestions
function getRouteSuggestion(method, path) {
  const pathParts = path.split("/").filter((part) => part);

  if (method === "POST" && pathParts.length === 3) {
    return `Custom document IDs are not supported with POST. To create a document in collection '${pathParts[1]}' of project '${pathParts[0]}' with auto-generated _name, use: POST /${pathParts[0]}/${pathParts[1]}`;
  } else if (method === "POST" && pathParts.length === 2) {
    return `To create a document in collection '${pathParts[1]}' of project '${pathParts[0]}' with auto-generated _name, use: POST /${pathParts[0]}/${pathParts[1]}`;
  } else if (method === "GET" && pathParts.length === 3) {
    return `To get document '${pathParts[2]}' from collection '${pathParts[1]}' of project '${pathParts[0]}', use: GET /${pathParts[0]}/${pathParts[1]}/${pathParts[2]}`;
  } else if (method === "GET" && pathParts.length === 2) {
    return `To get all documents from collection '${pathParts[1]}' of project '${pathParts[0]}', use: GET /${pathParts[0]}/${pathParts[1]}`;
  } else if (method === "PUT" && pathParts.length === 3) {
    return `To set (create or replace) document '${pathParts[2]}' in collection '${pathParts[1]}' of project '${pathParts[0]}', use: PUT /${pathParts[0]}/${pathParts[1]}/${pathParts[2]} (ID must be URL-safe, <24 chars)`;
  }

  return `Check the available routes listed above for the correct API endpoint format.`;
}

// Start server
async function startServer() {
  await connectToMongoDB();

  // Setup authentication routes after MongoDB connection
  setupAuthRoutes(app, mongoClient, checkConnection);

  // 404 handler - must be after all other routes
  app.use((req, res) => {
    console.log(`[404] ${req.method} ${req.path} - Route not found`);
    console.log(`[404] Available routes for data operations:`);
    console.log(
      `  POST /${req.params.projectName || "[projectName]"}/${
        req.params.collectionName || "[collectionName]"
      } - Create document (auto-generated _name)`
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
      `  PUT /${req.params.projectName || "[projectName]"}/${
        req.params.collectionName || "[collectionName]"
      }/[documentId] - Set document (create or replace with specific _name)`
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
        create: "POST /:projectName/:collectionName (auto-generated _name)",
        read: "GET /:projectName/:collectionName or GET /:projectName/:collectionName/:documentId",
        update: "PATCH /:projectName/:collectionName/:documentId",
        set: "PUT /:projectName/:collectionName/:documentId (create or replace with specific _name)",
        delete: "DELETE /:projectName/:collectionName/:documentId",
        auth: "POST /requestCode, POST /verifyCode",
        projects: "GET /projects, POST /projects",
      },
    });
  });

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
