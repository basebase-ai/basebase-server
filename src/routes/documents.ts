import { Router, Response } from "express";
import { AuthenticatedRequest } from "../types";
import { ValidationResult } from "../types/database";
import { getDbAndCollection } from "../database/collections";
import {
  resolveProjectDatabaseName,
  isValidCollectionName,
  isValidDocumentId,
  buildDocumentQuery,
  validateCreationPermissions,
} from "../database/validation";
import {
  convertFromFirestoreFormat,
  convertToFirestoreFormat,
} from "../database/conversion";
import { generateName } from "../utils/generators";
import {
  requireOwnershipForUpdate,
  requireOwnershipForDelete,
} from "../middleware/security";
import { ensureCollectionSecurity } from "../database/security-rules";

const router = Router();

// CREATE - POST document (auto-generated _id)
router.post(
  "/v1/projects/:projectId/databases/\\(default\\)/documents/:collectionId",
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

      // Ensure security rules are applied to the collection
      await ensureCollectionSecurity(targetDbName, collectionId);

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

      // Set owner and timestamps
      const now = new Date();
      document.ownerId = req.user!.userId; // Set the current user as owner
      document.createTime = now;
      document.updateTime = now;

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
router.get(
  "/v1/projects/:projectId/databases/\\(default\\)/documents/:collectionId/_security",
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

      // Ensure security rules are applied to the collection
      await ensureCollectionSecurity(targetDbName, collectionId);

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
router.put(
  "/v1/projects/:projectId/databases/\\(default\\)/documents/:collectionId/_security",
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
router.get(
  "/v1/projects/:projectId/databases/\\(default\\)/documents/:collectionId/:documentId",
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

      // Ensure security rules are applied to the collection
      await ensureCollectionSecurity(targetDbName, collectionId);

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
router.get(
  "/v1/projects/:projectId/databases/\\(default\\)/documents/:collectionId",
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

      // Ensure security rules are applied to the collection
      await ensureCollectionSecurity(targetDbName, collectionId);

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
router.patch(
  "/v1/projects/:projectId/databases/\\(default\\)/documents/:collectionId/:documentId",
  requireOwnershipForUpdate,
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

      // Ensure security rules are applied to the collection
      await ensureCollectionSecurity(targetDbName, collectionId);

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

// SET - PUT document (create or replace with specific _id)
router.put(
  "/v1/projects/:projectId/databases/\\(default\\)/documents/:collectionId/:documentId",
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

      // Ensure security rules are applied to the collection
      await ensureCollectionSecurity(targetDbName, collectionId);

      const { collection } = getDbAndCollection(targetDbName, collectionId);
      const document = convertFromFirestoreFormat(req.body);

      // Build query to find existing document by _id or _id (for backward compatibility)
      const query = buildDocumentQuery(documentId);
      const existingDoc = await collection.findOne(query);

      const now = new Date();
      if (existingDoc) {
        // Check ownership for updates
        const documentOwnerId = existingDoc.ownerId;
        if (documentOwnerId && documentOwnerId !== req.user!.userId) {
          return res.status(403).json({
            error: "Access denied",
            suggestion: "You can only modify documents that you own.",
            details: {
              operation: "update",
              documentId,
              requiredOwner: documentOwnerId,
              currentUser: req.user!.userId,
            },
          });
        }

        // Update existing document - MERGE fields instead of replacing
        // Remove immutable fields
        delete document._id;
        delete document.createTime;
        delete document.ownerId; // Don't allow ownership changes

        // Set update timestamp
        document.updateTime = now;

        console.log(
          `[SET] Merging fields into existing document ${documentId} in ${targetDbName}/${collectionId}`
        );
        await collection.updateOne(query, { $set: document });

        // Get the updated document for response
        const updatedDoc = await collection.findOne(query);
        if (!updatedDoc) {
          return res.status(500).json({
            error: "Document update failed",
            suggestion:
              "The document may have been deleted during the update. Please try again.",
          });
        }
        res.json(convertToFirestoreFormat(updatedDoc));
      } else {
        // Create new document
        document._id = documentId; // Only set _id for new documents
        document.ownerId = req.user!.userId; // Set owner for new documents
        document.createTime = now;
        document.updateTime = now;

        console.log(
          `[SET] Creating new document ${documentId} in ${targetDbName}/${collectionId}`
        );
        await collection.insertOne(document);
        res.json(convertToFirestoreFormat(document));
      }

      console.log(
        `[SET] Successfully set document ${documentId} in ${targetDbName}/${collectionId}`
      );
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
router.delete(
  "/v1/projects/:projectId/databases/\\(default\\)/documents/:collectionId/:documentId",
  requireOwnershipForDelete,
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

      // Ensure security rules are applied to the collection
      await ensureCollectionSecurity(targetDbName, collectionId);

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

export default router;
