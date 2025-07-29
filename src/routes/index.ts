import { Express } from "express";
import { checkConnection } from "../database/connection";
import { authenticateToken } from "../../auth";
import documentsRoutes from "./documents";
import tasksRoutes from "./tasks";
import triggersRoutes from "./triggers";
import queriesRoutes from "./queries";
import healthRoutes, { create404Handler } from "./health";
import projectsRoutes from "./projects";

// Setup all routes with proper middleware
export function setupRoutes(app: Express): void {
  // Health check routes (no auth required)
  app.use(healthRoutes);

  // Projects routes (no auth required)
  app.use(projectsRoutes);

  // Document CRUD routes (auth + connection required)
  app.use(checkConnection, authenticateToken, documentsRoutes);

  // Task management routes (auth + connection required)
  app.use(checkConnection, authenticateToken, tasksRoutes);

  // Trigger management routes (auth + connection required)
  app.use(checkConnection, authenticateToken, triggersRoutes);

  // Query routes (auth + connection required)
  app.use(checkConnection, authenticateToken, queriesRoutes);

  // 404 handler (must be last)
  app.use("*", create404Handler());

  console.log("✅ All routes configured successfully");
}
