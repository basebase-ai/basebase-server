import { MongoClient } from "mongodb";
import { Request, Response, NextFunction } from "express";

// MongoDB connection
let mongoClient: MongoClient;
let isConnected = false;

export async function connectToMongoDB(): Promise<void> {
  try {
    mongoClient = new MongoClient(process.env.MONGODB_URI!);
    await mongoClient.connect();
    isConnected = true;
    console.log("Connected to MongoDB Atlas");
  } catch (error) {
    console.error("MongoDB connection error:", error);
    process.exit(1);
  }
}

// Middleware to check DB connection
export function checkConnection(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!isConnected) {
    res.status(503).json({ error: "Database connection not available" });
    return;
  }
  next();
}

// Get the MongoDB client instance
export function getMongoClient(): MongoClient {
  if (!mongoClient) {
    throw new Error(
      "MongoDB client not initialized. Call connectToMongoDB() first."
    );
  }
  return mongoClient;
}

// Close MongoDB connection
export async function closeConnection(): Promise<void> {
  if (mongoClient) {
    await mongoClient.close();
    isConnected = false;
    console.log("MongoDB connection closed");
  }
}
