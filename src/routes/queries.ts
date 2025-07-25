import { Router, Response } from "express";
import { AuthenticatedRequest } from "../types";
import { getDbAndCollection } from "../database/collections";
import {
  resolveProjectDatabaseName,
  isValidCollectionName,
} from "../database/validation";
import { convertToFirestoreFormat } from "../database/conversion";

const router = Router();

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
  } else if (value.timestampValue !== undefined) {
    mongoValue = new Date(value.timestampValue);
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
          if (v.timestampValue !== undefined) return new Date(v.timestampValue);
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
          if (v.timestampValue !== undefined) return new Date(v.timestampValue);
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
router.post(
  "/v1/projects/:projectId/databases/\\(default\\)/documents:runQuery",
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

export default router;
