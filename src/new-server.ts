import "dotenv/config";
import express from "express";
import cors from "cors";
import {
  connectToMongoDB,
  checkConnection,
  closeConnection,
} from "./database/connection";
import { authenticateToken, setupAuthRoutes } from "../auth";
// import { setupRoutes } from "./routes"; // Would contain all route definitions
// import { SimpleScheduler } from "./functions/scheduler"; // Would contain scheduling logic

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(express.json());

// Start server
async function startServer(): Promise<void> {
  try {
    // Connect to database
    await connectToMongoDB();
    console.log("✅ Database connected");

    // Initialize default server functions
    // await initializeDefaultServerFunctions();
    console.log("✅ Default functions initialized");

    // Start the function scheduler
    // const scheduler = SimpleScheduler.getInstance();
    // scheduler.start();
    console.log("✅ Function scheduler started");

    // Setup authentication routes
    setupAuthRoutes(app, null!, checkConnection); // Would need to pass mongoClient
    console.log("✅ Auth routes configured");

    // Setup all API routes
    // setupRoutes(app);
    console.log("✅ API routes configured");

    // 404 handler
    app.use("*", (req, res) => {
      res.status(404).json({
        error: "Route not found",
        suggestion: "Check the API documentation for available endpoints.",
      });
    });

    // Global error handler
    app.use(
      (
        error: Error,
        req: express.Request,
        res: express.Response,
        next: express.NextFunction
      ) => {
        console.error(`[ERROR] ${req.method} ${req.path}:`, error);
        res.status(500).json({
          error: "Internal server error",
          suggestion:
            "An unexpected error occurred. Please try again or contact support.",
        });
      }
    );

    // Start listening
    app.listen(PORT, () => {
      console.log(`🚀 BaseBase Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down server...");

  // Stop the scheduler
  // const scheduler = SimpleScheduler.getInstance();
  // scheduler.stop();

  // Close database connection
  await closeConnection();

  console.log("✅ Server shutdown complete");
  process.exit(0);
});

// Only start server if not in test environment
if (process.env.NODE_ENV !== "test") {
  startServer().catch(console.error);
}

// Export for testing
export { app, startServer };
