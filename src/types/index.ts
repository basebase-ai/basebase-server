// Re-export all types for easy importing
export * from "./database";
export * from "./functions";
export * from "./api";

// Common Express types
import { Request } from "express";

export interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    projectName: string;
  };
}
