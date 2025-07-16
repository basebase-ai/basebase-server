import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import { MongoClient, ObjectId, Collection, Db } from "mongodb";
import crypto from "crypto";
import cors from "cors";
import { authenticateToken, setupAuthRoutes } from "./auth";

interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    projectName: string;
  };
}

interface FirestoreDocument {
  name?: string;
  fields: Record<string, any>;
}

interface MongoDocument {
  _id?: any; // Allow ObjectId, string, or other types for flexibility
  [key: string]: any;
}

interface ValidationResult {
  dbExists: boolean;
  collectionExists: boolean;
}

interface CollectionMetadata {
  projectName: string;
  collectionName: string;
  rules: any[];
  indexes: IndexDefinition[];
  createdAt: Date;
  updatedAt: Date;
}

interface IndexDefinition {
  fields: Record<string, number>;
  options?: Record<string, any>;
}

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB connection
let mongoClient: MongoClient;
let isConnected = false;

async function connectToMongoDB(): Promise<void> {
  try {
    mongoClient = new MongoClient(process.env.MONGODB_URI!);
    await mongoClient.connect();
    isConnected = true;
    console.log("Connected to MongoDB Atlas");
  } catch (error) {
    console.error("MongoDB connection error:", error);
    process.exit(1);
  }
}

// Middleware to check DB connection
function checkConnection(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!isConnected) {
    res.status(503).json({ error: "Database connection not available" });
    return;
  }
  next();
}

// Helper function to get database and collection
function getDbAndCollection(
  projectName: string,
  collectionName: string
): { db: Db; collection: Collection } {
  const db = mongoClient.db(projectName);
  const collection = db.collection(collectionName);
  return { db, collection };
}

function isValidObjectId(id: string): boolean {
  return ObjectId.isValid(id);
}

function isValidName(name: string): boolean {
  if (!name || name.length === 0 || name.length >= 24) {
    return false;
  }

  // URL-safe characters only
  return /^[a-zA-Z0-9_-]+$/.test(name);
}

function isValidDocumentId(id: string): boolean {
  // Allow both ObjectId format (for backward compatibility) and custom names
  return isValidObjectId(id) || isValidName(id);
}

// Helper function to generate 72-bit base64 _id ID
function generateName(): string {
  // Generate 9 bytes (72 bits) of random data
  const randomBytes = crypto.randomBytes(9);
  // Convert to base64 and make URL-safe
  return randomBytes.toString("base64url");
}

// Helper function to find document by _id
function buildDocumentQuery(documentId: string): Record<string, any> {
  // Try both string ID and ObjectId to handle all cases
  if (ObjectId.isValid(documentId) && documentId.length === 24) {
    // Could be either a string that looks like ObjectId or an actual ObjectId
    return {
      $or: [{ _id: documentId }, { _id: new ObjectId(documentId) }],
    };
  }
  // Custom string ID
  return { _id: documentId };
}

// Helper function to resolve project name to database name
async function resolveProjectDatabaseName(
  projectName: string
): Promise<string> {
  const projectsCollection = mongoClient.db("basebase").collection("projects");

  // First try to find by database name (exact match)
  const project = await projectsCollection.findOne({
    name: projectName,
  });

  if (!project) {
    throw new Error(`Project '${projectName}' not found`);
  }

  return project.name;
}

// Helper function to check if database/collection exists
async function checkDbCollectionExists(
  projectName: string,
  collectionName: string
): Promise<ValidationResult> {
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
  requestedProjectName: string,
  userProjectName: string,
  collectionName: string
): Promise<ValidationResult> {
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
async function initializeCollectionMetadata(
  projectName: string,
  collectionName: string
): Promise<void> {
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
    const defaultMetadata: CollectionMetadata = {
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
async function applyCollectionIndexes(
  projectName: string,
  collectionName: string
): Promise<void> {
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
        console.error(
          `[INDEX] Failed to create index:`,
          (indexError as Error).message
        );
        // Continue with other indexes - don't let one failure stop the rest
      }
    }
  } catch (error) {
    console.error(
      `[INDEX] Error applying indexes for ${projectName}/${collectionName}:`,
      (error as Error).message
    );
    // Don't throw error - index application shouldn't block document operations
  }
}

// Helper function to generate index name from fields
function generateIndexName(fields: Record<string, number>): string {
  return Object.entries(fields)
    .map(([field, direction]) => `${field}_${direction}`)
    .join("_");
}

// Helper function to convert Firestore-style document to MongoDB format
function convertFromFirestoreFormat(firestoreDoc: any): MongoDocument {
  if (!firestoreDoc.fields) {
    return firestoreDoc;
  }

  const mongoDoc: MongoDocument = {};
  for (const [key, value] of Object.entries(firestoreDoc.fields)) {
    if ((value as any).stringValue !== undefined) {
      mongoDoc[key] = (value as any).stringValue;
    } else if ((value as any).integerValue !== undefined) {
      mongoDoc[key] = parseInt((value as any).integerValue);
    } else if ((value as any).doubleValue !== undefined) {
      mongoDoc[key] = parseFloat((value as any).doubleValue);
    } else if ((value as any).booleanValue !== undefined) {
      mongoDoc[key] = (value as any).booleanValue;
    } else if ((value as any).nullValue !== undefined) {
      mongoDoc[key] = null;
    } else if ((value as any).arrayValue !== undefined) {
      // Handle Firebase arrayValue format
      const arrayValue = (value as any).arrayValue;
      if (arrayValue.values && Array.isArray(arrayValue.values)) {
        mongoDoc[key] = arrayValue.values.map((item: any) => {
          // Convert each array item from Firebase format
          if (item.stringValue !== undefined) {
            return item.stringValue;
          } else if (item.integerValue !== undefined) {
            return parseInt(item.integerValue);
          } else if (item.doubleValue !== undefined) {
            return parseFloat(item.doubleValue);
          } else if (item.booleanValue !== undefined) {
            return item.booleanValue;
          } else if (item.nullValue !== undefined) {
            return null;
          } else if (item.arrayValue !== undefined) {
            // Recursively handle nested arrays
            return convertFromFirestoreFormat({ fields: { temp: item } }).temp;
          } else {
            // Return as-is if it's already a plain value
            return item;
          }
        });
      } else {
        // Empty array case
        mongoDoc[key] = [];
      }
    } else {
      mongoDoc[key] = value;
    }
  }
  return mongoDoc;
}

// Helper function to convert MongoDB document to Firestore-style format
function convertToFirestoreFormat(mongoDoc: MongoDocument): FirestoreDocument {
  const firestoreDoc: FirestoreDocument = { fields: {} };

  for (const [key, value] of Object.entries(mongoDoc)) {
    if (key === "_id") {
      // Use the _id as the document name (convert ObjectId to string if needed)
      firestoreDoc.name = value?.toString() || value;
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
    } else if (value instanceof Date) {
      firestoreDoc.fields[key] = { stringValue: value.toISOString() };
    } else if (Array.isArray(value)) {
      // Handle arrays by converting to Firebase arrayValue format
      firestoreDoc.fields[key] = {
        arrayValue: {
          values: value.map((item: any) => {
            if (typeof item === "string") {
              return { stringValue: item };
            } else if (typeof item === "number") {
              if (Number.isInteger(item)) {
                return { integerValue: item.toString() };
              } else {
                return { doubleValue: item };
              }
            } else if (typeof item === "boolean") {
              return { booleanValue: item };
            } else if (item === null) {
              return { nullValue: null };
            } else if (item instanceof Date) {
              return { stringValue: item.toISOString() };
            } else if (Array.isArray(item)) {
              // Recursively handle nested arrays
              const nestedArray = convertToFirestoreFormat({
                temp: item,
              } as MongoDocument);
              return nestedArray.fields.temp;
            } else {
              // Return as-is for complex objects
              return item;
            }
          }),
        },
      };
    } else {
      firestoreDoc.fields[key] = value;
    }
  }

  return firestoreDoc;
}

// CRUD ENDPOINTS (JWT required)

// CREATE - POST document (auto-generated _id ID)
app.post(
  "/projects/:projectId/databases/\\(default\\)/documents/:collectionId",
  checkConnection,
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { projectId, collectionId } = req.params;

      console.log(
        `[CREATE] POST /projects/${projectId}/databases/(default)/documents/${collectionId}`
      );
      console.log(
        `[CREATE] User: ${req.user!.userId}, Project: ${req.user!.projectName}`
      );
      console.log(`[CREATE] Body:`, req.body);

      // Use project name from JWT (already sanitized) for permission checks
      const userProjectName = req.user!.projectName;

      // Resolve the requested project name to database name
      let targetDbName: string;
      try {
        targetDbName = await resolveProjectDatabaseName(projectId);
      } catch (resolveError) {
        console.error(`[CREATE] Project resolution failed:`, resolveError);
        return res.status(404).json({
          error: (resolveError as Error).message,
          suggestion: `Make sure the project '${projectId}' exists and you have access to it.`,
        });
      }

      // Validate creation permissions - prevents creating databases/collections outside user's project
      let validationResult: ValidationResult;
      try {
        validationResult = await validateCreationPermissions(
          targetDbName,
          userProjectName,
          collectionId
        );
      } catch (validationError) {
        console.error(
          `[CREATE] Permission validation failed:`,
          validationError
        );
        return res.status(403).json({
          error: (validationError as Error).message,
          suggestion: `You can only create documents in collections within your project '${userProjectName}'.`,
        });
      }

      const { collection } = getDbAndCollection(targetDbName, collectionId);
      const document = convertFromFirestoreFormat(req.body);

      // Generate unique _id
      let documentId: string;
      let attempts = 0;
      const maxAttempts = 5;

      do {
        documentId = generateName();
        attempts++;

        if (attempts > maxAttempts) {
          console.error(
            `[CREATE] Failed to generate unique document ID after ${maxAttempts} attempts`
          );
          return res.status(500).json({
            error: "Failed to generate unique document ID",
            suggestion: "Please try again in a moment.",
          });
        }

        const existingDoc = await collection.findOne({
          _id: documentId,
        } as any);

        if (!existingDoc) {
          break;
        }
      } while (attempts <= maxAttempts);

      // Set the _id field to our custom ID
      document._id = documentId;

      // Set timestamps
      const now = new Date();
      document.createdAt = now;
      document.updatedAt = now;

      console.log(
        `[CREATE] Inserting document with _id: ${documentId} in ${targetDbName}/${collectionId}`
      );
      const result = await collection.insertOne(document);

      console.log(
        `[CREATE] Successfully created document ${documentId} in ${targetDbName}/${collectionId}`
      );

      // Convert to Firestore format for response
      const responseDoc = convertToFirestoreFormat(document);

      res.status(201).json(responseDoc);
    } catch (error) {
      console.error(`[CREATE] Error creating document:`, error);
      res.status(500).json({
        error: "Failed to create document",
        suggestion:
          "Check your data format and try again. Contact support if the problem persists.",
      });
    }
  }
);

// GET security rules for a collection
app.get(
  "/projects/:projectId/databases/\\(default\\)/documents/:collectionId/_security",
  checkConnection,
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { projectId, collectionId } = req.params;

      // Resolve the requested project name to database name
      let targetDbName: string;
      try {
        targetDbName = await resolveProjectDatabaseName(projectId);
      } catch (resolveError) {
        return res.status(404).json({ error: (resolveError as Error).message });
      }

      const { db } = getDbAndCollection(targetDbName, collectionId);
      const collectionsCollection = db.collection("collections");

      const collectionMetadata = await collectionsCollection.findOne({
        projectName: targetDbName,
        collectionName: collectionId,
      });

      if (!collectionMetadata) {
        // Return default rules and empty indexes if collection metadata doesn't exist
        return res.json({
          rules: [
            {
              match: "/documents/{document}",
              allow: ["read", "write"],
              condition: "true", // Allow all by default
            },
          ],
          indexes: [],
        });
      }

      res.json({
        rules: collectionMetadata.rules || [],
        indexes: collectionMetadata.indexes || [],
      });
    } catch (error) {
      console.error("Get security rules error:", error);
      res.status(500).json({ error: "Failed to get security rules" });
    }
  }
);

// PUT security rules for a collection
app.put(
  "/projects/:projectId/databases/\\(default\\)/documents/:collectionId/_security",
  checkConnection,
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { projectId, collectionId } = req.params;
      const { rules, indexes } = req.body;

      // Resolve the requested project name to database name
      let targetDbName: string;
      try {
        targetDbName = await resolveProjectDatabaseName(projectId);
      } catch (resolveError) {
        return res.status(404).json({ error: (resolveError as Error).message });
      }

      const { db } = getDbAndCollection(targetDbName, collectionId);
      const collectionsCollection = db.collection("collections");

      const now = new Date();
      const updateData: any = {
        projectName: targetDbName,
        collectionName: collectionId,
        updatedAt: now,
      };

      if (rules !== undefined) {
        updateData.rules = rules;
      }

      if (indexes !== undefined) {
        updateData.indexes = indexes;
      }

      const result = await collectionsCollection.updateOne(
        {
          projectName: targetDbName,
          collectionName: collectionId,
        },
        {
          $set: updateData,
          $setOnInsert: {
            createdAt: now,
          },
        },
        { upsert: true }
      );

      console.log(
        `Updated security rules and indexes for ${targetDbName}/${collectionId}`
      );

      res.json({
        message: "Collection metadata updated successfully",
        updated: result.modifiedCount > 0,
        created: result.upsertedCount > 0,
      });
    } catch (error) {
      console.error("Update security rules error:", error);
      res.status(500).json({ error: "Failed to update security rules" });
    }
  }
);

// READ - GET single document
app.get(
  "/projects/:projectId/databases/\\(default\\)/documents/:collectionId/:documentId",
  checkConnection,
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { projectId, collectionId, documentId } = req.params;

      console.log(
        `[READ] GET /projects/${projectId}/databases/(default)/documents/${collectionId}/${documentId}`
      );
      console.log(
        `[READ] User: ${req.user!.userId}, Project: ${req.user!.projectName}`
      );

      // Resolve the requested project name to database name
      let targetDbName: string;
      try {
        targetDbName = await resolveProjectDatabaseName(projectId);
      } catch (resolveError) {
        console.error(`[READ] Project resolution failed:`, resolveError);
        return res.status(404).json({
          error: (resolveError as Error).message,
          suggestion: `Make sure the project '${projectId}' exists and you have access to it.`,
        });
      }

      const { collection } = getDbAndCollection(targetDbName, collectionId);

      // Build query to find document by _id or _id (for backward compatibility)
      const query = buildDocumentQuery(documentId);
      const document = await collection.findOne(query);

      if (!document) {
        console.log(
          `[READ] Document not found: ${documentId} in ${targetDbName}/${collectionId}`
        );
        return res.status(404).json({
          error: "Document not found",
          suggestion: `Check that the document ID '${documentId}' exists in collection '${collectionId}'.`,
        });
      }

      console.log(
        `[READ] Successfully retrieved document ${documentId} from ${targetDbName}/${collectionId}`
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
  "/projects/:projectId/databases/\\(default\\)/documents/:collectionId",
  checkConnection,
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { projectId, collectionId } = req.params;

      // Resolve the requested project name to database name
      let targetDbName: string;
      try {
        targetDbName = await resolveProjectDatabaseName(projectId);
      } catch (resolveError) {
        return res.status(404).json({ error: (resolveError as Error).message });
      }

      const { collection } = getDbAndCollection(targetDbName, collectionId);

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
  "/projects/:projectId/databases/\\(default\\)/documents/:collectionId/:documentId",
  checkConnection,
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { projectId, collectionId, documentId } = req.params;

      console.log(
        `[UPDATE] PATCH /projects/${projectId}/databases/(default)/documents/${collectionId}/${documentId}`
      );
      console.log(
        `[UPDATE] User: ${req.user!.userId}, Project: ${req.user!.projectName}`
      );
      console.log(`[UPDATE] Body:`, req.body);

      // Resolve the requested project name to database name
      let targetDbName: string;
      try {
        targetDbName = await resolveProjectDatabaseName(projectId);
      } catch (resolveError) {
        console.error(`[UPDATE] Project resolution failed:`, resolveError);
        return res.status(404).json({
          error: (resolveError as Error).message,
          suggestion: `Make sure the project '${projectId}' exists and you have access to it.`,
        });
      }

      const { collection } = getDbAndCollection(targetDbName, collectionId);

      // Build query to find document by _id or _id (for backward compatibility)
      const query = buildDocumentQuery(documentId);

      // Check if document exists
      const existingDoc = await collection.findOne(query);
      if (!existingDoc) {
        console.log(
          `[UPDATE] Document not found: ${documentId} in ${targetDbName}/${collectionId}`
        );
        return res.status(404).json({
          error: "Document not found",
          suggestion: `Check that the document ID '${documentId}' exists in collection '${collectionId}'.`,
        });
      }

      // Convert from Firestore format and extract fields to update
      const updateData = convertFromFirestoreFormat(req.body);

      // Remove immutable fields
      delete updateData._id;
      delete updateData._id;
      delete updateData.createTime;

      // Set update timestamp
      updateData.updateTime = new Date();

      console.log(
        `[UPDATE] Updating document ${documentId} in ${targetDbName}/${collectionId}`
      );
      const result = await collection.updateOne(query, { $set: updateData });

      if (result.matchedCount === 0) {
        console.log(
          `[UPDATE] Document not found during update: ${documentId} in ${targetDbName}/${collectionId}`
        );
        return res.status(404).json({
          error: "Document not found",
          suggestion: `The document '${documentId}' may have been deleted.`,
        });
      }

      // Get the updated document
      const updatedDoc = await collection.findOne(query);

      if (!updatedDoc) {
        console.error(
          `[UPDATE] Document disappeared after update: ${documentId} in ${targetDbName}/${collectionId}`
        );
        return res.status(500).json({
          error: "Document update failed",
          suggestion:
            "The document may have been deleted during the update. Please try again.",
        });
      }

      console.log(
        `[UPDATE] Successfully updated document ${documentId} in ${targetDbName}/${collectionId}`
      );

      res.json(convertToFirestoreFormat(updatedDoc));
    } catch (error) {
      console.error(`[UPDATE] Error updating document:`, error);
      res.status(500).json({
        error: "Failed to update document",
        suggestion:
          "Check your data format and try again. Contact support if the problem persists.",
      });
    }
  }
);

// SET - PUT document (create or replace with specific _id ID)
app.put(
  "/projects/:projectId/databases/\\(default\\)/documents/:collectionId/:documentId",
  checkConnection,
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { projectId, collectionId, documentId } = req.params;

      console.log(
        `[SET] PUT /projects/${projectId}/databases/(default)/documents/${collectionId}/${documentId}`
      );
      console.log(
        `[SET] User: ${req.user!.userId}, Project: ${req.user!.projectName}`
      );
      console.log(`[SET] Body:`, req.body);

      // Validate document ID format
      if (!isValidDocumentId(documentId)) {
        return res.status(400).json({
          error: "Invalid document ID",
          suggestion:
            "Document ID must be URL-safe, less than 24 characters, and contain only letters, numbers, hyphens, and underscores.",
        });
      }

      // Use project name from JWT (already sanitized) for permission checks
      const userProjectName = req.user!.projectName;

      // Resolve the requested project name to database name
      let targetDbName: string;
      try {
        targetDbName = await resolveProjectDatabaseName(projectId);
      } catch (resolveError) {
        console.error(`[SET] Project resolution failed:`, resolveError);
        return res.status(404).json({
          error: (resolveError as Error).message,
          suggestion: `Make sure the project '${projectId}' exists and you have access to it.`,
        });
      }

      // Validate creation permissions - prevents creating databases/collections outside user's project
      let validationResult: ValidationResult;
      try {
        validationResult = await validateCreationPermissions(
          targetDbName,
          userProjectName,
          collectionId
        );
      } catch (validationError) {
        console.error(`[SET] Permission validation failed:`, validationError);
        return res.status(403).json({
          error: (validationError as Error).message,
          suggestion: `You can only create documents in collections within your project '${userProjectName}'.`,
        });
      }

      const { collection } = getDbAndCollection(targetDbName, collectionId);
      const document = convertFromFirestoreFormat(req.body);

      // Build query to find existing document by _id or _id (for backward compatibility)
      const query = buildDocumentQuery(documentId);
      const existingDoc = await collection.findOne(query);

      const now = new Date();
      if (existingDoc) {
        // Update existing document (preserve createTime and existing _id)
        document._id = existingDoc._id; // Preserve the existing _id field exactly as it is
        document.createTime = existingDoc.createTime || now;
        document.updateTime = now;

        console.log(
          `[SET] Replacing existing document ${documentId} in ${targetDbName}/${collectionId}`
        );
        await collection.replaceOne(query, document);
      } else {
        // Create new document
        document._id = documentId; // Only set _id for new documents
        document.createTime = now;
        document.updateTime = now;

        console.log(
          `[SET] Creating new document ${documentId} in ${targetDbName}/${collectionId}`
        );
        await collection.insertOne(document);
      }

      console.log(
        `[SET] Successfully set document ${documentId} in ${targetDbName}/${collectionId}`
      );

      res.json(convertToFirestoreFormat(document));
    } catch (error) {
      console.error(`[SET] Error setting document:`, error);
      res.status(500).json({
        error: "Failed to set document",
        suggestion:
          "Check your data format and document ID, then try again. Contact support if the problem persists.",
      });
    }
  }
);

// DELETE - DELETE document
app.delete(
  "/projects/:projectId/databases/\\(default\\)/documents/:collectionId/:documentId",
  checkConnection,
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { projectId, collectionId, documentId } = req.params;

      console.log(
        `[DELETE] DELETE /projects/${projectId}/databases/(default)/documents/${collectionId}/${documentId}`
      );
      console.log(
        `[DELETE] User: ${req.user!.userId}, Project: ${req.user!.projectName}`
      );

      // Resolve the requested project name to database name
      let targetDbName: string;
      try {
        targetDbName = await resolveProjectDatabaseName(projectId);
      } catch (resolveError) {
        console.error(`[DELETE] Project resolution failed:`, resolveError);
        return res.status(404).json({
          error: (resolveError as Error).message,
          suggestion: `Make sure the project '${projectId}' exists and you have access to it.`,
        });
      }

      const { collection } = getDbAndCollection(targetDbName, collectionId);

      // Build query to find document by _id or _id (for backward compatibility)
      const query = buildDocumentQuery(documentId);

      console.log(
        `[DELETE] Deleting document ${documentId} from ${targetDbName}/${collectionId}`
      );
      const result = await collection.deleteOne(query);

      if (result.deletedCount === 0) {
        console.log(
          `[DELETE] Document not found: ${documentId} in ${targetDbName}/${collectionId}`
        );
        return res.status(404).json({
          error: "Document not found",
          suggestion: `Check that the document ID '${documentId}' exists in collection '${collectionId}'.`,
        });
      }

      console.log(
        `[DELETE] Successfully deleted document ${documentId} from ${targetDbName}/${collectionId}`
      );

      res.status(200).json({
        message: "Document deleted successfully",
        documentId,
      });
    } catch (error) {
      console.error(`[DELETE] Error deleting document:`, error);
      res.status(500).json({
        error: "Failed to delete document",
        suggestion:
          "Check your document ID and try again. Contact support if the problem persists.",
      });
    }
  }
);

// Health check endpoint
app.get("/health", (req: Request, res: Response) => {
  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  });
});

// Helper function to provide route suggestions
function getRouteSuggestion(method: string, path: string): string {
  const pathParts = path.split("/").filter((part) => part);

  if (
    method === "POST" &&
    pathParts.length === 6 &&
    pathParts[0] === "projects" &&
    pathParts[2] === "databases" &&
    pathParts[4] === "documents"
  ) {
    return `To create a document in collection '${pathParts[5]}' of project '${pathParts[1]}' with auto-generated _id, use: POST /projects/${pathParts[1]}/databases/(default)/documents/${pathParts[5]}`;
  } else if (
    method === "GET" &&
    pathParts.length === 7 &&
    pathParts[0] === "projects" &&
    pathParts[2] === "databases" &&
    pathParts[4] === "documents"
  ) {
    return `To get document '${pathParts[6]}' from collection '${pathParts[5]}' of project '${pathParts[1]}', use: GET /projects/${pathParts[1]}/databases/(default)/documents/${pathParts[5]}/${pathParts[6]}`;
  } else if (
    method === "GET" &&
    pathParts.length === 6 &&
    pathParts[0] === "projects" &&
    pathParts[2] === "databases" &&
    pathParts[4] === "documents"
  ) {
    return `To get all documents from collection '${pathParts[5]}' of project '${pathParts[1]}', use: GET /projects/${pathParts[1]}/databases/(default)/documents/${pathParts[5]}`;
  } else if (
    method === "PUT" &&
    pathParts.length === 7 &&
    pathParts[0] === "projects" &&
    pathParts[2] === "databases" &&
    pathParts[4] === "documents"
  ) {
    return `To set (create or replace) document '${pathParts[6]}' in collection '${pathParts[5]}' of project '${pathParts[1]}', use: PUT /projects/${pathParts[1]}/databases/(default)/documents/${pathParts[5]}/${pathParts[6]} (ID must be URL-safe, <24 chars)`;
  }

  return `Check the available routes listed above for the correct Firebase-style API endpoint format.`;
}

// Start server
async function startServer(): Promise<void> {
  await connectToMongoDB();

  // Setup authentication routes after MongoDB connection
  setupAuthRoutes(app, mongoClient, checkConnection);

  // 404 handler - must be after all other routes
  app.use((req: Request, res: Response) => {
    console.log(`[404] ${req.method} ${req.path} - Route not found`);
    console.log(`[404] Available routes for data operations:`);
    console.log(
      `  POST /projects/[projectId]/databases/(default)/documents/[collectionId] - Create document (auto-generated _id)`
    );
    console.log(
      `  GET /projects/[projectId]/databases/(default)/documents/[collectionId] - Get all documents`
    );
    console.log(
      `  GET /projects/[projectId]/databases/(default)/documents/[collectionId]/[documentId] - Get specific document`
    );
    console.log(
      `  PATCH /projects/[projectId]/databases/(default)/documents/[collectionId]/[documentId] - Update document`
    );
    console.log(
      `  PUT /projects/[projectId]/databases/(default)/documents/[collectionId]/[documentId] - Set document (create or replace with specific _id)`
    );
    console.log(
      `  DELETE /projects/[projectId]/databases/(default)/documents/[collectionId]/[documentId] - Delete document`
    );
    console.log(
      `  GET /projects/[projectId]/databases/(default)/documents/[collectionId]/_security - Get collection metadata`
    );
    console.log(
      `  PUT /projects/[projectId]/databases/(default)/documents/[collectionId]/_security - Update collection metadata`
    );

    res.status(404).json({
      error: "Route not found",
      method: req.method,
      path: req.path,
      suggestion: getRouteSuggestion(req.method, req.path),
      availableRoutes: {
        create:
          "POST /projects/:projectId/databases/(default)/documents/:collectionId (auto-generated _id)",
        read: "GET /projects/:projectId/databases/(default)/documents/:collectionId or GET /projects/:projectId/databases/(default)/documents/:collectionId/:documentId",
        update:
          "PATCH /projects/:projectId/databases/(default)/documents/:collectionId/:documentId",
        set: "PUT /projects/:projectId/databases/(default)/documents/:collectionId/:documentId (create or replace with specific _id)",
        delete:
          "DELETE /projects/:projectId/databases/(default)/documents/:collectionId/:documentId",
        metadata:
          "GET/PUT /projects/:projectId/databases/(default)/documents/:collectionId/_security",
        auth: "POST /requestCode, POST /verifyCode",
        projects: "GET /projects, POST /projects",
      },
    });
  });

  // Global error handler
  app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
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

// Test initialization function
async function initializeForTesting(): Promise<void> {
  await connectToMongoDB();
  setupAuthRoutes(app, mongoClient, checkConnection);
}

// Only start server if not in test environment
if (process.env.NODE_ENV !== "test") {
  startServer().catch(console.error);
}

// Export app and functions for testing
export { app, startServer, initializeForTesting };
