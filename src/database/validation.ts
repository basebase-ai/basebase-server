import { ObjectId } from "mongodb";
import { getMongoClient } from "./connection";
import { ValidationResult } from "../types/database";

export function isValidObjectId(id: string): boolean {
  return ObjectId.isValid(id);
}

export function isValidName(name: string): boolean {
  if (!name || name.length === 0 || name.length > 255) {
    return false;
  }

  // URL-safe characters only
  return /^[a-zA-Z0-9_-]+$/.test(name);
}

export function isValidCollectionName(name: string): boolean {
  if (!name || name.length === 0 || name.length > 255) {
    return false;
  }

  // Collection names must be lowercase with underscores/hyphens only
  // No uppercase letters allowed to enforce lowercase_with_underscores convention
  return /^[a-z0-9_-]+$/.test(name);
}

export function isValidDocumentId(id: string): boolean {
  // Allow both ObjectId format (for backward compatibility) and custom names
  return isValidObjectId(id) || isValidName(id);
}

// Helper function to find document by _id
export function buildDocumentQuery(documentId: string): Record<string, any> {
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
export async function resolveProjectDatabaseName(
  projectName: string
): Promise<string> {
  const mongoClient = getMongoClient();
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
export async function checkDbCollectionExists(
  projectName: string,
  collectionName: string
): Promise<ValidationResult> {
  const mongoClient = getMongoClient();
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
export async function validateCreationPermissions(
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
