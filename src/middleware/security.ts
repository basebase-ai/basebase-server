import { Request, Response, NextFunction } from "express";
import { getDbAndCollection } from "../database/collections";
import {
  buildDocumentQuery,
  resolveProjectDatabaseName,
} from "../database/validation";

interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    projectId: string;
    projectName: string;
  };
}

interface SecurityCheckOptions {
  operation: "read" | "write" | "delete";
  requireOwnership?: boolean;
}

/**
 * Security middleware that enforces owner-based access control for document operations.
 * Checks if the current user is the owner of the document being accessed.
 */
export async function enforceOwnerSecurity(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
  options: SecurityCheckOptions = { operation: "write", requireOwnership: true }
): Promise<void> {
  try {
    // Skip ownership check for read operations unless explicitly required
    if (options.operation === "read" && !options.requireOwnership) {
      next();
      return;
    }

    const { projectId, collectionId, documentId } = req.params;

    // Skip check if no documentId (collection-level operations)
    if (!documentId) {
      next();
      return;
    }

    // Get the current user
    const currentUserId = req.user?.userId;
    if (!currentUserId) {
      res.status(401).json({
        error: "Authentication required",
        suggestion: "Please provide a valid JWT token to access this document.",
      });
      return;
    }

    // Get target database name
    let targetDbName: string;
    try {
      targetDbName = await resolveProjectDatabaseName(projectId);
    } catch (resolveError) {
      res.status(404).json({
        error: (resolveError as Error).message,
        suggestion: `Make sure the project '${projectId}' exists and you have access to it.`,
      });
      return;
    }

    const { collection } = getDbAndCollection(targetDbName, collectionId);

    // Find the existing document
    const query = buildDocumentQuery(documentId);
    const existingDoc = await collection.findOne(query);

    if (!existingDoc) {
      // Document doesn't exist - allow creation if it's a write operation
      if (options.operation === "write") {
        next();
        return;
      } else {
        res.status(404).json({
          error: "Document not found",
          suggestion: `The document '${documentId}' does not exist.`,
        });
        return;
      }
    }

    // Check if user is the owner
    const documentOwnerId = existingDoc.ownerId;
    if (!documentOwnerId) {
      // Document has no owner - allow access for backward compatibility
      console.warn(
        `Document ${documentId} has no ownerId - allowing access for backward compatibility`
      );
      next();
      return;
    }

    if (documentOwnerId !== currentUserId) {
      res.status(403).json({
        error: "Access denied",
        suggestion: "You can only modify or delete documents that you own.",
        details: {
          operation: options.operation,
          documentId,
          requiredOwner: documentOwnerId,
          currentUser: currentUserId,
        },
      });
      return;
    }

    // User is the owner - allow access
    next();
  } catch (error) {
    console.error("Security check error:", error);
    res.status(500).json({
      error: "Security check failed",
      suggestion: "An error occurred while checking document permissions.",
    });
  }
}

/**
 * Convenience function to create security middleware for specific operations
 */
export function requireOwnershipFor(operation: "read" | "write" | "delete") {
  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    await enforceOwnerSecurity(req, res, next, {
      operation,
      requireOwnership: true,
    });
  };
}

/**
 * Middleware specifically for update operations
 */
export const requireOwnershipForUpdate = requireOwnershipFor("write");

/**
 * Middleware specifically for delete operations
 */
export const requireOwnershipForDelete = requireOwnershipFor("delete");
