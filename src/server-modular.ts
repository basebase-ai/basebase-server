import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";

// Modular imports
import {
  connectToMongoDB,
  checkConnection,
  closeConnection,
  getMongoClient,
} from "./database/connection";
import { setupRoutes } from "./routes";
import { authenticateToken, setupAuthRoutes } from "../auth";
import { initializeDefaultCloudTasks } from "./tasks/initialization";
import { SimpleScheduler } from "./tasks/scheduler";

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(express.json());

// Start server function
async function startServer(): Promise<void> {
  try {
    // 1. Connect to database
    await connectToMongoDB();
    console.log("✅ Database connected");

    // 2. Initialize default cloud tasks
    await initializeDefaultCloudTasks();
    console.log("✅ Default tasks initialized");

    // 3. Start scheduler
    const scheduler = SimpleScheduler.getInstance();
    scheduler.start();
    console.log("✅ Task scheduler started");

    // 4. Setup authentication routes
    setupAuthRoutes(app, getMongoClient(), checkConnection);
    console.log("✅ Auth routes configured");

    // 5. Setup all API routes (modular!)
    setupRoutes(app);
    console.log("✅ All API routes configured");

    // 6. Global error handler
    app.use((error: any, req: Request, res: Response, next: NextFunction) => {
      // Handle JSON parsing errors
      if (error instanceof SyntaxError && error.message.includes("JSON")) {
        return res.status(400).json({
          error: "Invalid JSON format",
          suggestion: "Please check your request body contains valid JSON",
        });
      }

      console.error(`[ERROR] ${req.method} ${req.path}:`, error);
      res.status(500).json({
        error: "Internal server error",
        suggestion:
          "An unexpected error occurred. Please try again or contact support.",
      });
    });

    // 7. Start listening
    app.listen(PORT, () => {
      console.log(`🚀 BaseBase Server running on port ${PORT}`);
      console.log(
        `📊 Server file: ${__filename
          .split("/")
          .pop()} (~${getLinesOfCode()} lines)`
      );
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
}

// Get approximate lines of code for this file
function getLinesOfCode(): number {
  return __filename.includes("server-modular") ? 85 : 2800; // This file vs old server.ts
}

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down server...");

  // Stop scheduler
  const scheduler = SimpleScheduler.getInstance();
  scheduler.stop();

  // Close database connection
  await closeConnection();

  console.log("✅ Server shutdown complete");
  process.exit(0);
});

// Test initialization function
async function initializeForTesting(): Promise<void> {
  await connectToMongoDB();
  await initializeDefaultCloudTasks();
  setupAuthRoutes(app, getMongoClient(), checkConnection);
  setupRoutes(app);

  // Add error handling for tests
  app.use((error: any, req: Request, res: Response, next: NextFunction) => {
    // Handle JSON parsing errors
    if (error instanceof SyntaxError && error.message.includes("JSON")) {
      return res.status(400).json({
        error: "Invalid JSON format",
        suggestion: "Please check your request body contains valid JSON",
      });
    }

    console.error(`[ERROR] ${req.method} ${req.path}:`, error);
    res.status(500).json({
      error: "Internal server error",
      suggestion:
        "An unexpected error occurred. Please try again or contact support.",
    });
  });
}

// Export for testing
export { app, startServer, initializeForTesting, initializeDefaultCloudTasks };

// Only start server if not in test environment
if (process.env.NODE_ENV !== "test") {
  startServer().catch(console.error);
}
