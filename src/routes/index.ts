import { Express } from "express";
import { checkConnection } from "../database/connection";
import { authenticateToken } from "../../auth";
import documentsRoutes from "./documents";
import functionsRoutes from "./functions";
import queriesRoutes from "./queries";
import healthRoutes, { create404Handler } from "./health";

// Setup all routes with proper middleware
export function setupRoutes(app: Express): void {
  // Health check routes (no auth required)
  app.use(healthRoutes);

  // Document CRUD routes (auth + connection required)
  app.use(checkConnection, authenticateToken, documentsRoutes);

  // Function management routes (auth + connection required)
  app.use(checkConnection, authenticateToken, functionsRoutes);

  // Query routes (auth + connection required)
  app.use(checkConnection, authenticateToken, queriesRoutes);

  // 404 handler (must be last)
  app.use("*", create404Handler());

  console.log("✅ All routes configured successfully");
}
