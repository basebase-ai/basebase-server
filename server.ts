import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import { MongoClient, ObjectId, Collection, Db } from "mongodb";
import crypto from "crypto";
import cors from "cors";
import axios from "axios";
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

interface ServerFunction {
  _id: string;
  description: string;
  implementationCode: string;
  requiredServices: string[];
  createdAt: Date;
  updatedAt: Date;
}

interface FunctionExecutionContext {
  user: {
    userId: string;
    projectName: string;
  };
  project: {
    name: string;
  };
}

interface FunctionCallRequest {
  data: Record<string, any>;
}

const app = express();
const PORT = process.env.PORT || 8000;

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
  if (!name || name.length === 0 || name.length > 255) {
    return false;
  }

  // URL-safe characters only
  return /^[a-zA-Z0-9_-]+$/.test(name);
}

function isValidCollectionName(name: string): boolean {
  if (!name || name.length === 0 || name.length > 255) {
    return false;
  }

  // Collection names must be lowercase with underscores/hyphens only
  // No uppercase letters allowed to enforce lowercase_with_underscores convention
  return /^[a-z0-9_-]+$/.test(name);
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
    _id: projectName,
  } as any);

  if (!project) {
    throw new Error(`Project '${projectName}' not found`);
  }

  // Since we found the project by _id: projectName, projectName is the database name
  return projectName;
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

  // Allow anyone to create collections in the "public" project
  if (requestedProjectName === "public") {
    return { dbExists, collectionExists };
  }

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

// Helper function to get server functions collection
function getServerFunctionsCollection(): Collection<ServerFunction> {
  return mongoClient
    .db("basebase")
    .collection<ServerFunction>("server_functions");
}

// Helper function to initialize default server functions
async function initializeDefaultServerFunctions(): Promise<void> {
  try {
    const functionsCollection = getServerFunctionsCollection();

    // Check if functions already exist
    const existingCount = await functionsCollection.countDocuments();
    if (existingCount > 0) {
      console.log("Server functions already initialized");
      return;
    }

    const now = new Date();

    // getPage function
    const getPageFunction: ServerFunction = {
      _id: "getPage",
      description:
        "Retrieves the contents of a webpage located at a URL using HTTP GET and returns them as a string. Required parameters: 'url' of type string.",
      implementationCode: `
        async (params, context) => {
          if (!params.url || typeof params.url !== 'string') {
            throw new Error('Parameter "url" is required and must be a string');
          }
          
          try {
            const response = await axios.get(params.url, {
              timeout: 10000, // 10 second timeout
              maxRedirects: 5,
              headers: {
                'User-Agent': 'BaseBase-Server/1.0'
              }
            });
            
            return {
              success: true,
              data: response.data,
              status: response.status,
              headers: response.headers,
              url: response.config.url
            };
          } catch (error) {
            if (error.response) {
              return {
                success: false,
                error: 'HTTP Error: ' + error.response.status,
                status: error.response.status,
                data: error.response.data
              };
            } else if (error.request) {
              return {
                success: false,
                error: 'Network Error: Could not reach the URL'
              };
            } else {
              return {
                success: false,
                error: 'Request Error: ' + error.message
              };
            }
          }
        }
      `,
      requiredServices: ["axios"],
      createdAt: now,
      updatedAt: now,
    };

    // sendSms function
    const sendSmsFunction: ServerFunction = {
      _id: "sendSms",
      description:
        "Sends an SMS message to a phone number using Twilio. Required parameters: 'to' (phone number), 'message' (text content).",
      implementationCode: `
        async (params, context) => {
          if (!params.to || typeof params.to !== 'string') {
            throw new Error('Parameter "to" is required and must be a string (phone number)');
          }
          
          if (!params.message || typeof params.message !== 'string') {
            throw new Error('Parameter "message" is required and must be a string');
          }
          
          try {
            // Note: This would require Twilio client to be available in execution context
            // For now, we'll return a mock response
            console.log(\`SMS would be sent to \${params.to}: \${params.message}\`);
            
            return {
              success: true,
              message: 'SMS sent successfully (mock)',
              to: params.to,
              messageLength: params.message.length,
              timestamp: new Date().toISOString()
            };
          } catch (error) {
            return {
              success: false,
              error: 'SMS Error: ' + error.message
            };
          }
        }
      `,
      requiredServices: ["twilio"],
      createdAt: now,
      updatedAt: now,
    };

    await functionsCollection.insertMany([getPageFunction, sendSmsFunction]);
    console.log("Initialized default server functions: getPage, sendSms");
  } catch (error) {
    console.error("Failed to initialize default server functions:", error);
  }
}

// Helper function to execute server function code safely
async function executeServerFunction(
  functionCode: string,
  params: Record<string, any>,
  context: FunctionExecutionContext,
  requiredServices: string[]
): Promise<any> {
  try {
    // Create execution sandbox with available services
    const services: Record<string, any> = {};

    // Add requested services
    for (const service of requiredServices) {
      switch (service) {
        case "axios":
          services.axios = axios;
          break;
        case "twilio":
          // Note: In a production environment, you'd want to initialize Twilio client here
          services.twilio = null; // Placeholder
          break;
        default:
          console.warn(`Unknown service requested: ${service}`);
      }
    }

    // Create the function from the code string
    const AsyncFunction = Object.getPrototypeOf(
      async function () {}
    ).constructor;
    const userFunction = new AsyncFunction(
      "params",
      "context",
      "axios",
      "twilio",
      `
        "use strict";
        return (${functionCode})(params, context);
      `
    );

    // Execute with timeout
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Function execution timeout")), 30000); // 30 second timeout
    });

    const executionPromise = userFunction(
      params,
      context,
      services.axios,
      services.twilio
    );

    const result = await Promise.race([executionPromise, timeoutPromise]);
    return result;
  } catch (error) {
    console.error("Function execution error:", error);
    throw new Error(`Function execution failed: ${(error as Error).message}`);
  }
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

// SERVER FUNCTIONS ENDPOINTS (JWT required)

// LIST SERVER FUNCTIONS - GET
app.get(
  "/v1/functions",
  checkConnection,
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      console.log(`[FUNCTION] GET /v1/functions`);
      console.log(
        `[FUNCTION] User: ${req.user!.userId}, Project: ${
          req.user!.projectName
        }`
      );

      const functionsCollection = getServerFunctionsCollection();
      const functions = await functionsCollection
        .find({}, { projection: { implementationCode: 0 } }) // Exclude implementation code from listing
        .toArray();

      console.log(`[FUNCTION] Found ${functions.length} server functions`);

      res.json({
        functions: functions.map((func) => ({
          id: func._id,
          description: func.description,
          requiredServices: func.requiredServices,
          createdAt: func.createdAt,
          updatedAt: func.updatedAt,
        })),
        count: functions.length,
      });
    } catch (error) {
      console.error(`[FUNCTION] Error listing functions:`, error);
      res.status(500).json({
        error: "Failed to list functions",
        suggestion: "Contact support if the problem persists.",
      });
    }
  }
);

// GET SPECIFIC SERVER FUNCTION - GET
app.get(
  "/v1/functions/:functionName",
  checkConnection,
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { functionName } = req.params;

      console.log(`[FUNCTION] GET /v1/functions/${functionName}`);
      console.log(
        `[FUNCTION] User: ${req.user!.userId}, Project: ${
          req.user!.projectName
        }`
      );

      const functionsCollection = getServerFunctionsCollection();
      const serverFunction = await functionsCollection.findOne({
        _id: functionName,
      });

      if (!serverFunction) {
        console.log(`[FUNCTION] Function not found: ${functionName}`);
        return res.status(404).json({
          error: "Function not found",
          suggestion: `The function '${functionName}' does not exist.`,
        });
      }

      console.log(`[FUNCTION] Retrieved function ${functionName}`);

      res.json({
        id: serverFunction._id,
        description: serverFunction.description,
        implementationCode: serverFunction.implementationCode,
        requiredServices: serverFunction.requiredServices,
        createdAt: serverFunction.createdAt,
        updatedAt: serverFunction.updatedAt,
      });
    } catch (error) {
      console.error(`[FUNCTION] Error getting function:`, error);
      res.status(500).json({
        error: "Failed to get function",
        suggestion: "Contact support if the problem persists.",
      });
    }
  }
);

// CALL SERVER FUNCTION - POST (Firebase pattern with :call)
app.post(
  /^\/v1\/projects\/([^\/]+)\/functions\/([^\/]+):call$/,
  checkConnection,
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Extract projectId and functionName from regex match
      const match = req.path.match(
        /^\/v1\/projects\/([^\/]+)\/functions\/([^\/]+):call$/
      );
      if (!match) {
        return res.status(400).json({
          error: "Invalid route format",
          suggestion:
            "Use format: /v1/projects/{projectId}/functions/{functionName}:call",
        });
      }

      const projectId = match[1];
      const functionName = match[2];
      const { data } = req.body as FunctionCallRequest;

      console.log(
        `[FUNCTION] POST /v1/projects/${projectId}/functions/${functionName}:call`
      );
      console.log(
        `[FUNCTION] User: ${req.user!.userId}, Project: ${
          req.user!.projectName
        }`
      );
      console.log(`[FUNCTION] Function: ${functionName}, Data:`, data);

      // Resolve the requested project name to database name
      let targetDbName: string;
      try {
        targetDbName = await resolveProjectDatabaseName(projectId);
      } catch (resolveError) {
        console.error(`[FUNCTION] Project resolution failed:`, resolveError);
        return res.status(404).json({
          error: (resolveError as Error).message,
          suggestion: `Make sure the project '${projectId}' exists and you have access to it.`,
        });
      }

      // Check if user has access to the project
      if (req.user!.projectName !== targetDbName) {
        console.error(
          `[FUNCTION] Access denied: User project ${
            req.user!.projectName
          } does not match target ${targetDbName}`
        );
        return res.status(403).json({
          error: "Access denied",
          suggestion: `You can only call functions in your own project '${
            req.user!.projectName
          }'.`,
        });
      }

      // Get the server function from the database
      const functionsCollection = getServerFunctionsCollection();
      const serverFunction = await functionsCollection.findOne({
        _id: functionName,
      });

      if (!serverFunction) {
        console.log(`[FUNCTION] Function not found: ${functionName}`);
        return res.status(404).json({
          error: "Function not found",
          suggestion: `The function '${functionName}' does not exist. Available functions can be found in the server functions collection.`,
        });
      }

      // Prepare execution context
      const executionContext: FunctionExecutionContext = {
        user: {
          userId: req.user!.userId,
          projectName: req.user!.projectName,
        },
        project: {
          name: targetDbName,
        },
      };

      console.log(`[FUNCTION] Executing function ${functionName}`);

      // Execute the function
      try {
        const result = await executeServerFunction(
          serverFunction.implementationCode,
          data || {},
          executionContext,
          serverFunction.requiredServices
        );

        console.log(
          `[FUNCTION] Function ${functionName} executed successfully`
        );

        res.json({
          success: true,
          result: result,
          functionName: functionName,
          executedAt: new Date().toISOString(),
        });
      } catch (executionError) {
        console.error(
          `[FUNCTION] Function execution failed for ${functionName}:`,
          executionError
        );
        return res.status(500).json({
          error: "Function execution failed",
          details: (executionError as Error).message,
          functionName: functionName,
          suggestion:
            "Check the function parameters and try again. Contact support if the problem persists.",
        });
      }
    } catch (error) {
      console.error(`[FUNCTION] Error calling function:`, error);
      res.status(500).json({
        error: "Failed to call function",
        suggestion:
          "Check your request format and try again. Contact support if the problem persists.",
      });
    }
  }
);

// CRUD ENDPOINTS (JWT required)

// CREATE - POST document (auto-generated _id ID)
app.post(
  "/v1/projects/:projectId/databases/\\(default\\)/documents/:collectionId",
  checkConnection,
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { projectId, collectionId } = req.params;

      // Validate collection name format
      if (!isValidCollectionName(collectionId)) {
        return res.status(400).json({
          error: "Invalid collection name",
          suggestion:
            "Collection names must be lowercase with underscores/hyphens only (e.g., 'user_profiles', 'order-items'). No uppercase letters or camelCase allowed.",
        });
      }

      console.log(
        `[CREATE] POST /v1/projects/${projectId}/databases/(default)/documents/${collectionId}`
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
  "/v1/projects/:projectId/databases/\\(default\\)/documents/:collectionId/_security",
  checkConnection,
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { projectId, collectionId } = req.params;

      // Validate collection name format
      if (!isValidCollectionName(collectionId)) {
        return res.status(400).json({
          error: "Invalid collection name",
          suggestion:
            "Collection names must be lowercase with underscores/hyphens only (e.g., 'user_profiles', 'order-items'). No uppercase letters or camelCase allowed.",
        });
      }

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
  "/v1/projects/:projectId/databases/\\(default\\)/documents/:collectionId/_security",
  checkConnection,
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { projectId, collectionId } = req.params;
      const { rules, indexes } = req.body;

      // Validate collection name format
      if (!isValidCollectionName(collectionId)) {
        return res.status(400).json({
          error: "Invalid collection name",
          suggestion:
            "Collection names must be lowercase with underscores/hyphens only (e.g., 'user_profiles', 'order-items'). No uppercase letters or camelCase allowed.",
        });
      }

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
  "/v1/projects/:projectId/databases/\\(default\\)/documents/:collectionId/:documentId",
  checkConnection,
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { projectId, collectionId, documentId } = req.params;

      // Validate collection name format
      if (!isValidCollectionName(collectionId)) {
        return res.status(400).json({
          error: "Invalid collection name",
          suggestion:
            "Collection names must be lowercase with underscores/hyphens only (e.g., 'user_profiles', 'order-items'). No uppercase letters or camelCase allowed.",
        });
      }

      console.log(
        `[READ] GET /v1/projects/${projectId}/databases/(default)/documents/${collectionId}/${documentId}`
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
  "/v1/projects/:projectId/databases/\\(default\\)/documents/:collectionId",
  checkConnection,
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { projectId, collectionId } = req.params;

      // Validate collection name format
      if (!isValidCollectionName(collectionId)) {
        return res.status(400).json({
          error: "Invalid collection name",
          suggestion:
            "Collection names must be lowercase with underscores/hyphens only (e.g., 'user_profiles', 'order-items'). No uppercase letters or camelCase allowed.",
        });
      }

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

// Helper function to convert Firestore field filter to MongoDB query
function convertFieldFilter(fieldFilter: any): any {
  const { field, op, value } = fieldFilter;
  const fieldPath = field.fieldPath;

  let mongoValue: any;
  if (value.stringValue !== undefined) {
    mongoValue = value.stringValue;
  } else if (value.integerValue !== undefined) {
    mongoValue = parseInt(value.integerValue);
  } else if (value.doubleValue !== undefined) {
    mongoValue = parseFloat(value.doubleValue);
  } else if (value.booleanValue !== undefined) {
    mongoValue = value.booleanValue;
  } else if (value.nullValue !== undefined) {
    mongoValue = null;
  } else {
    mongoValue = value;
  }

  switch (op) {
    case "EQUAL":
      return { [fieldPath]: mongoValue };
    case "NOT_EQUAL":
      return { [fieldPath]: { $ne: mongoValue } };
    case "LESS_THAN":
      return { [fieldPath]: { $lt: mongoValue } };
    case "LESS_THAN_OR_EQUAL":
      return { [fieldPath]: { $lte: mongoValue } };
    case "GREATER_THAN":
      return { [fieldPath]: { $gt: mongoValue } };
    case "GREATER_THAN_OR_EQUAL":
      return { [fieldPath]: { $gte: mongoValue } };
    case "ARRAY_CONTAINS":
      return { [fieldPath]: mongoValue };
    case "IN":
      if (value.arrayValue && value.arrayValue.values) {
        const inValues = value.arrayValue.values.map((v: any) => {
          if (v.stringValue !== undefined) return v.stringValue;
          if (v.integerValue !== undefined) return parseInt(v.integerValue);
          if (v.doubleValue !== undefined) return parseFloat(v.doubleValue);
          if (v.booleanValue !== undefined) return v.booleanValue;
          return v;
        });
        return { [fieldPath]: { $in: inValues } };
      }
      return { [fieldPath]: { $in: [] } };
    case "NOT_IN":
      if (value.arrayValue && value.arrayValue.values) {
        const notInValues = value.arrayValue.values.map((v: any) => {
          if (v.stringValue !== undefined) return v.stringValue;
          if (v.integerValue !== undefined) return parseInt(v.integerValue);
          if (v.doubleValue !== undefined) return parseFloat(v.doubleValue);
          if (v.booleanValue !== undefined) return v.booleanValue;
          return v;
        });
        return { [fieldPath]: { $nin: notInValues } };
      }
      return { [fieldPath]: { $nin: [] } };
    case "MATCHES":
      return { [fieldPath]: { $regex: new RegExp(mongoValue, "i") } };
    default:
      throw new Error(`Unsupported filter operator: ${op}`);
  }
}

// Helper function to convert Firestore where clause to MongoDB query
function convertWhereClause(where: any): any {
  if (where.fieldFilter) {
    return convertFieldFilter(where.fieldFilter);
  }

  if (where.compositeFilter) {
    const { op, filters } = where.compositeFilter;
    const mongoFilters = filters.map((filter: any) =>
      convertWhereClause(filter)
    );

    if (op === "AND") {
      return { $and: mongoFilters };
    } else if (op === "OR") {
      return { $or: mongoFilters };
    } else {
      throw new Error(`Unsupported composite filter operator: ${op}`);
    }
  }

  throw new Error("Invalid where clause format");
}

// Helper function to convert Firestore orderBy to MongoDB sort
function convertOrderBy(orderBy: any[]): any {
  const sort: any = {};
  for (const order of orderBy) {
    const fieldPath = order.field.fieldPath;
    const direction = order.direction === "DESCENDING" ? -1 : 1;
    sort[fieldPath] = direction;
  }
  return sort;
}

// QUERY - POST runQuery (Firebase/Firestore compatible)
app.post(
  "/v1/projects/:projectId/databases/\\(default\\)/documents:runQuery",
  checkConnection,
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { projectId } = req.params;
      const { structuredQuery } = req.body;

      if (!structuredQuery) {
        return res.status(400).json({
          error: "Missing structuredQuery in request body",
        });
      }

      // Resolve the requested project name to database name
      let targetDbName: string;
      try {
        targetDbName = await resolveProjectDatabaseName(projectId);
      } catch (resolveError) {
        return res.status(404).json({ error: (resolveError as Error).message });
      }

      // Extract collection from the 'from' clause
      if (!structuredQuery.from || structuredQuery.from.length === 0) {
        return res.status(400).json({
          error: "Missing 'from' clause in structuredQuery",
        });
      }

      const collectionId = structuredQuery.from[0].collectionId;
      if (!collectionId) {
        return res.status(400).json({
          error: "Missing 'collectionId' in 'from' clause",
        });
      }

      // Validate collection name format
      if (!isValidCollectionName(collectionId)) {
        return res.status(400).json({
          error: "Invalid collection name",
          suggestion:
            "Collection names must be lowercase with underscores/hyphens only (e.g., 'user_profiles', 'order-items'). No uppercase letters or camelCase allowed.",
        });
      }

      const { collection } = getDbAndCollection(targetDbName, collectionId);

      // Build MongoDB query from Firestore where clause
      let mongoQuery: any = {};
      if (structuredQuery.where) {
        try {
          mongoQuery = convertWhereClause(structuredQuery.where);
        } catch (whereError) {
          return res.status(400).json({
            error: `Invalid where clause: ${(whereError as Error).message}`,
          });
        }
      }

      // Build MongoDB sort from Firestore orderBy
      let mongoSort: any = {};
      if (structuredQuery.orderBy && structuredQuery.orderBy.length > 0) {
        try {
          mongoSort = convertOrderBy(structuredQuery.orderBy);
        } catch (sortError) {
          return res.status(400).json({
            error: `Invalid orderBy clause: ${(sortError as Error).message}`,
          });
        }
      }

      // Apply limit if specified
      let query = collection.find(mongoQuery);
      if (Object.keys(mongoSort).length > 0) {
        query = query.sort(mongoSort);
      }
      if (structuredQuery.limit) {
        const limit = parseInt(structuredQuery.limit);
        if (limit > 0) {
          query = query.limit(limit);
        }
      }

      const documents = await query.toArray();

      // Convert to Firebase runQuery response format
      const response = documents.map((doc) => {
        const firestoreDoc = convertToFirestoreFormat(doc);
        return {
          document: firestoreDoc,
          readTime: new Date().toISOString(),
        };
      });

      res.json(response);
    } catch (error) {
      console.error("Run query error:", error);
      res.status(500).json({ error: "Failed to execute query" });
    }
  }
);

// UPDATE - PATCH document
app.patch(
  "/v1/projects/:projectId/databases/\\(default\\)/documents/:collectionId/:documentId",
  checkConnection,
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { projectId, collectionId, documentId } = req.params;

      // Validate collection name format
      if (!isValidCollectionName(collectionId)) {
        return res.status(400).json({
          error: "Invalid collection name",
          suggestion:
            "Collection names must be lowercase with underscores/hyphens only (e.g., 'user_profiles', 'order-items'). No uppercase letters or camelCase allowed.",
        });
      }

      console.log(
        `[UPDATE] PATCH /v1/projects/${projectId}/databases/(default)/documents/${collectionId}/${documentId}`
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
  "/v1/projects/:projectId/databases/\\(default\\)/documents/:collectionId/:documentId",
  checkConnection,
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { projectId, collectionId, documentId } = req.params;

      // Validate collection name format
      if (!isValidCollectionName(collectionId)) {
        return res.status(400).json({
          error: "Invalid collection name",
          suggestion:
            "Collection names must be lowercase with underscores/hyphens only (e.g., 'user_profiles', 'order-items'). No uppercase letters or camelCase allowed.",
        });
      }

      console.log(
        `[SET] PUT /v1/projects/${projectId}/databases/(default)/documents/${collectionId}/${documentId}`
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
            "Document ID must be URL-safe, up to 255 characters, and contain only letters, numbers, hyphens, and underscores.",
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
  "/v1/projects/:projectId/databases/\\(default\\)/documents/:collectionId/:documentId",
  checkConnection,
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { projectId, collectionId, documentId } = req.params;

      // Validate collection name format
      if (!isValidCollectionName(collectionId)) {
        return res.status(400).json({
          error: "Invalid collection name",
          suggestion:
            "Collection names must be lowercase with underscores/hyphens only (e.g., 'user_profiles', 'order-items'). No uppercase letters or camelCase allowed.",
        });
      }

      console.log(
        `[DELETE] DELETE /v1/projects/${projectId}/databases/(default)/documents/${collectionId}/${documentId}`
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
    return `To create a document in collection '${pathParts[5]}' of project '${pathParts[1]}' with auto-generated _id, use: POST /v1/projects/${pathParts[1]}/databases/(default)/documents/${pathParts[5]}`;
  } else if (
    method === "GET" &&
    pathParts.length === 7 &&
    pathParts[0] === "projects" &&
    pathParts[2] === "databases" &&
    pathParts[4] === "documents"
  ) {
    return `To get document '${pathParts[6]}' from collection '${pathParts[5]}' of project '${pathParts[1]}', use: GET /v1/projects/${pathParts[1]}/databases/(default)/documents/${pathParts[5]}/${pathParts[6]}`;
  } else if (
    method === "GET" &&
    pathParts.length === 6 &&
    pathParts[0] === "projects" &&
    pathParts[2] === "databases" &&
    pathParts[4] === "documents"
  ) {
    return `To get all documents from collection '${pathParts[5]}' of project '${pathParts[1]}', use: GET /v1/projects/${pathParts[1]}/databases/(default)/documents/${pathParts[5]}`;
  } else if (
    method === "PUT" &&
    pathParts.length === 7 &&
    pathParts[0] === "projects" &&
    pathParts[2] === "databases" &&
    pathParts[4] === "documents"
  ) {
    return `To set (create or replace) document '${pathParts[6]}' in collection '${pathParts[5]}' of project '${pathParts[1]}', use: PUT /v1/projects/${pathParts[1]}/databases/(default)/documents/${pathParts[5]}/${pathParts[6]} (ID must be URL-safe, ≤255 chars)`;
  }

  return `Check the available routes listed above for the correct Firebase-style API endpoint format.`;
}

// Start server
async function startServer(): Promise<void> {
  await connectToMongoDB();

  // Initialize default server functions
  await initializeDefaultServerFunctions();

  // Setup authentication routes after MongoDB connection
  setupAuthRoutes(app, mongoClient, checkConnection);

  // 404 handler - must be after all other routes
  app.use((req: Request, res: Response) => {
    console.log(`[404] ${req.method} ${req.path} - Route not found`);
    console.log(`[404] Available routes for data operations:`);
    console.log(
      `  POST /v1/projects/[projectId]/databases/(default)/documents/[collectionId] - Create document (auto-generated _id)`
    );
    console.log(
      `  GET /v1/projects/[projectId]/databases/(default)/documents/[collectionId] - Get all documents`
    );
    console.log(
      `  GET /v1/projects/[projectId]/databases/(default)/documents/[collectionId]/[documentId] - Get specific document`
    );
    console.log(
      `  PATCH /v1/projects/[projectId]/databases/(default)/documents/[collectionId]/[documentId] - Update document`
    );
    console.log(
      `  PUT /v1/projects/[projectId]/databases/(default)/documents/[collectionId]/[documentId] - Set document (create or replace with specific _id)`
    );
    console.log(
      `  DELETE /v1/projects/[projectId]/databases/(default)/documents/[collectionId]/[documentId] - Delete document`
    );
    console.log(
      `  GET /v1/projects/[projectId]/databases/(default)/documents/[collectionId]/_security - Get collection metadata`
    );
    console.log(
      `  PUT /v1/projects/[projectId]/databases/(default)/documents/[collectionId]/_security - Update collection metadata`
    );
    console.log(`[404] Available routes for server functions:`);
    console.log(`  GET /v1/functions - List all server functions`);
    console.log(
      `  GET /v1/functions/[functionName] - Get specific function details`
    );
    console.log(
      `  POST /v1/projects/[projectId]/functions/[functionName]:call - Call server function`
    );

    res.status(404).json({
      error: "Route not found",
      method: req.method,
      path: req.path,
      suggestion: getRouteSuggestion(req.method, req.path),
      availableRoutes: {
        create:
          "POST /v1/projects/:projectId/databases/(default)/documents/:collectionId (auto-generated _id)",
        read: "GET /v1/projects/:projectId/databases/(default)/documents/:collectionId or GET /v1/projects/:projectId/databases/(default)/documents/:collectionId/:documentId",
        update:
          "PATCH /v1/projects/:projectId/databases/(default)/documents/:collectionId/:documentId",
        set: "PUT /v1/projects/:projectId/databases/(default)/documents/:collectionId/:documentId (create or replace with specific _id)",
        delete:
          "DELETE /v1/projects/:projectId/databases/(default)/documents/:collectionId/:documentId",
        metadata:
          "GET/PUT /v1/projects/:projectId/databases/(default)/documents/:collectionId/_security",
        auth: "POST /v1/requestCode, POST /v1/verifyCode",
        projects: "GET /v1/projects, POST /v1/projects",
        functions:
          "GET /v1/functions, GET /v1/functions/:functionName, POST /v1/projects/:projectId/functions/:functionName:call",
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
  await initializeDefaultServerFunctions();
  setupAuthRoutes(app, mongoClient, checkConnection);
}

// Only start server if not in test environment
if (process.env.NODE_ENV !== "test") {
  startServer().catch(console.error);
}

// Export app and functions for testing
export {
  app,
  startServer,
  initializeForTesting,
  initializeDefaultServerFunctions,
};
