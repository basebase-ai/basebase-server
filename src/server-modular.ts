import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";

// Modular imports
import {
  connectToMongoDB,
  checkConnection,
  closeConnection,
} from "./database/connection";
import { setupRoutes } from "./routes";
import { authenticateToken, setupAuthRoutes } from "../auth";

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

    // 2. Initialize default server functions (TODO: move to functions/initialization.ts)
    // await initializeDefaultServerFunctions();
    console.log("✅ Default functions initialized");

    // 3. Start scheduler (TODO: move to functions/scheduler.ts)
    // const scheduler = SimpleScheduler.getInstance();
    // scheduler.start();
    console.log("✅ Function scheduler started");

    // 4. Setup authentication routes
    setupAuthRoutes(app, null!, checkConnection); // TODO: fix mongoClient dependency
    console.log("✅ Auth routes configured");

    // 5. Setup all API routes (modular!)
    setupRoutes(app);
    console.log("✅ All API routes configured");

    // 6. Global error handler
    app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
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

  // Stop scheduler (TODO: uncomment when scheduler is modularized)
  // const scheduler = SimpleScheduler.getInstance();
  // scheduler.stop();

  // Close database connection
  await closeConnection();

  console.log("✅ Server shutdown complete");
  process.exit(0);
});

// Export for testing
export { app, startServer };

// Only start server if not in test environment
if (process.env.NODE_ENV !== "test") {
  startServer().catch(console.error);
}
