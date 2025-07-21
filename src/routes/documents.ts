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

const router = Router();

// This file will contain all document CRUD operations:
// - CREATE: POST document (auto-generated _id)
// - READ: GET single document, GET collection
// - UPDATE: PATCH document
// - SET: PUT document (create or replace with specific _id)
// - DELETE: DELETE document
// - Security rules: GET/PUT collection metadata

export default router;
