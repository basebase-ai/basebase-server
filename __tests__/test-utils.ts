import { MongoClient, ObjectId } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";

const JWT_SECRET = process.env.JWT_SECRET || "test-secret-key";

export class TestHelper {
  public mongoServer!: MongoMemoryServer;
  public mongoClient!: MongoClient;
  public mongoUri!: string;
  public app: any;
  private testPhoneNumber = "+15551234567";
  private testCode = "123456";

  async setup(): Promise<void> {
    console.log("Setting up test environment...");

    // Set environment variables before starting anything
    process.env.NODE_ENV = "test";
    process.env.JWT_SECRET = JWT_SECRET;

    // Twilio test credentials (mock)
    process.env.TWILIO_ACCOUNT_SID = "test_account_sid";
    process.env.TWILIO_AUTH_TOKEN = "test_auth_token";
    process.env.TWILIO_PHONE_NUMBER = "+15551111111";

    // Mock Twilio globally
    jest.doMock("twilio", () => {
      return jest.fn().mockImplementation(() => ({
        messages: {
          create: jest.fn().mockResolvedValue({ sid: "mock_message_sid" }),
        },
      }));
    });

    try {
      // Start MongoDB Memory Server with configuration
      console.log("Starting MongoDB Memory Server...");
      this.mongoServer = await MongoMemoryServer.create({
        instance: {
          port: 0, // Let it choose a random port
          dbName: "test",
        },
        binary: {
          downloadDir:
            "./node_modules/.cache/mongodb-memory-server/mongodb-binaries",
          version: "6.0.4", // Use a stable version
        },
      });

      this.mongoUri = this.mongoServer.getUri();

      // Set environment variable for server
      process.env.MONGODB_URI = this.mongoUri;

      console.log(`MongoDB Memory Server started at: ${this.mongoUri}`);

      // Connect our test client to MongoDB
      this.mongoClient = new MongoClient(this.mongoUri);
      await this.mongoClient.connect();
      console.log("Test client connected to MongoDB Memory Server");

      // Clear the require cache to ensure fresh imports
      const serverPath = require.resolve("../dist/src/server-modular.js");
      console.log("Server path resolved to:", serverPath);
      delete require.cache[serverPath];

      try {
        delete require.cache[require.resolve("../src/server-modular.ts")];
      } catch (e) {
        // Ignore if server-modular.ts can't be resolved
      }

      // Import the server from compiled JavaScript
      const serverModule = require("../dist/src/server-modular.js");
      console.log("Server module keys:", Object.keys(serverModule));
      this.app = serverModule.app;

      // Initialize the server (connects to MongoDB and sets up routes)
      if (typeof serverModule.initializeForTesting === "function") {
        await serverModule.initializeForTesting();
        console.log("Server initialized for testing");

        // Debug: Check registered routes
        console.log("Registered routes:");
        this.app._router.stack.forEach((middleware: any) => {
          if (middleware.route) {
            const methods = Object.keys(middleware.route.methods)
              .join(", ")
              .toUpperCase();
            console.log(`  ${methods} ${middleware.route.path}`);
          } else if (middleware.name === "router") {
            middleware.handle.stack.forEach((handler: any) => {
              if (handler.route) {
                const methods = Object.keys(handler.route.methods)
                  .join(", ")
                  .toUpperCase();
                console.log(`  ${methods} ${handler.route.path}`);
              }
            });
          }
        });
      } else {
        throw new Error(
          "initializeForTesting function not found in server module"
        );
      }
    } catch (error) {
      console.error("Failed to setup test environment:", error);
      throw error;
    }
  }

  async teardown(): Promise<void> {
    console.log("Tearing down test environment...");

    try {
      if (this.mongoClient) {
        await this.mongoClient.close();
      }

      if (this.mongoServer) {
        await this.mongoServer.stop();
      }

      console.log("Test environment torn down");
    } catch (error) {
      console.error("Error during teardown:", error);
    }
  }

  async createTestProject(): Promise<void> {
    console.log("Creating test project...");

    // For testing, we need to create a project first to get an API key
    const testProjectApiKey = "bb_test_api_key_for_testing";

    // Insert a test project directly into MongoDB for testing
    const projectsCollection = this.mongoClient
      .db("basebase")
      .collection("projects");
    await projectsCollection.insertOne({
      _id: "test-project",
      displayName: "Test Project",
      description: "A test project",
      ownerId: "test-user-id", // Use a consistent test user ID
      apiKey: testProjectApiKey,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);
  }

  async createTestUser(): Promise<string> {
    console.log("Creating test user...");

    try {
      // Step 1: Request verification code - needs username and phone
      const requestResponse = await request(this.app)
        .post("/v1/requestCode")
        .send({
          username: "Test User",
          phone: this.testPhoneNumber,
        });

      if (requestResponse.status !== 200) {
        console.error("RequestCode failed:", {
          status: requestResponse.status,
          body: requestResponse.body,
          text: requestResponse.text,
        });
      }

      expect(requestResponse.status).toBe(200);
      expect(requestResponse.body.message).toBeDefined();

      const testProjectApiKey = "bb_test_api_key_for_testing";

      // Get the actual verification code from MongoDB
      const codesCollection = this.mongoClient
        .db("basebase")
        .collection("verification_codes");
      const verificationCodeDoc = await codesCollection.findOne({
        phone: this.testPhoneNumber,
      });

      if (!verificationCodeDoc) {
        throw new Error("Verification code not found in database");
      }

      const actualCode = verificationCodeDoc.code;
      console.log("Using actual verification code:", actualCode);

      // Step 2: Verify code and get JWT - needs phone, code, and projectApiKey
      const verifyResponse = await request(this.app)
        .post("/v1/verifyCode")
        .send({
          phone: this.testPhoneNumber,
          code: actualCode,
          projectApiKey: testProjectApiKey,
        });

      if (verifyResponse.status !== 200) {
        console.error("VerifyCode failed:", {
          status: verifyResponse.status,
          body: verifyResponse.body,
          text: verifyResponse.text,
        });
      }

      expect(verifyResponse.status).toBe(200);
      expect(verifyResponse.body.token).toBeDefined();

      console.log("Test user created successfully");
      return verifyResponse.body.token;
    } catch (error) {
      console.error("Error creating test user:", error);
      throw error;
    }
  }

  async cleanupTestData(): Promise<void> {
    console.log("Cleaning up test data...");

    try {
      // List all databases
      const admin = this.mongoClient.db().admin();
      const dbs = await admin.listDatabases();

      // Drop all test databases (skip system databases)
      for (const db of dbs.databases) {
        if (!["admin", "local", "config"].includes(db.name)) {
          await this.mongoClient.db(db.name).dropDatabase();
          console.log(`Dropped database: ${db.name}`);
        }
      }

      // Re-initialize cloud tasks since we dropped the basebase database
      const serverModule = require("../dist/src/server-modular.js");
      if (typeof serverModule.initializeDefaultCloudTasks === "function") {
        await serverModule.initializeDefaultCloudTasks();
        console.log("Re-initialized cloud tasks after cleanup");
      }
    } catch (error) {
      console.error("Error cleaning up test data:", error);
    }

    console.log("Test data cleanup completed");
  }

  authenticatedRequest(token: string) {
    return {
      get: (url: string) =>
        request(this.app).get(url).set("Authorization", `Bearer ${token}`),
      post: (url: string) =>
        request(this.app).post(url).set("Authorization", `Bearer ${token}`),
      put: (url: string) =>
        request(this.app).put(url).set("Authorization", `Bearer ${token}`),
      patch: (url: string) =>
        request(this.app).patch(url).set("Authorization", `Bearer ${token}`),
      delete: (url: string) =>
        request(this.app).delete(url).set("Authorization", `Bearer ${token}`),
    };
  }
}
