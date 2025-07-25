import jwt from "jsonwebtoken";
import crypto from "crypto";
import twilio from "twilio";
import { Express, Request, Response, NextFunction } from "express";
import { MongoClient, ObjectId } from "mongodb";

interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    projectId: string;
    projectName: string;
  };
}

interface User {
  _id: string;
  name: string;
  phone: string;
  createdAt: Date;
  updatedAt: Date;
}

interface Project {
  _id: string;
  name: string;
  description: string;
  ownerId: string;
  apiKey: string;
  createdAt: Date;
  updatedAt: Date;
}

interface VerificationCode {
  _id?: ObjectId;
  phone: string;
  code: string;
  expiresAt: Date;
  createdAt: Date;
}

interface FirestoreProject {
  name: string;
  fields: {
    name: { stringValue: string };
    description: { stringValue: string };
    ownerId: { stringValue: string };
    createdAt: { timestampValue: string };
    updatedAt: { timestampValue: string };
  };
}

interface FirestoreUser {
  name: string;
  fields: {
    name: { stringValue: string };
    phone: { stringValue: string };
    createdAt: { timestampValue: string };
    updatedAt: { timestampValue: string };
  };
}

// Initialize Twilio client
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
);

const JWT_SECRET =
  process.env.JWT_SECRET || "your-secret-key-change-in-production";

// Helper function to generate secure API key
function generateApiKey(): string {
  return "bb_" + crypto.randomBytes(32).toString("hex");
}

// Helper function to sanitize project name for MongoDB database name
function sanitizeProjectName(name: string): string {
  if (!name || typeof name !== "string") {
    throw new Error("Project name must be a non-empty string");
  }

  // Convert to lowercase and remove whitespace
  let sanitized = name.toLowerCase().trim();

  // Replace spaces and invalid characters with underscores (keep only letters, numbers, and underscores)
  sanitized = sanitized.replace(/[^a-z0-9_]/g, "_");

  // Remove consecutive underscores
  sanitized = sanitized.replace(/_{2,}/g, "_");

  // Remove leading/trailing underscores
  sanitized = sanitized.replace(/^_+|_+$/g, "");

  // Ensure it's not empty after sanitization
  if (!sanitized) {
    throw new Error("Project name contains only invalid characters");
  }

  // Ensure it meets MongoDB length limits (max 64 characters)
  if (sanitized.length > 60) {
    // Leave room for potential numbering
    sanitized = sanitized.substring(0, 60);
  }

  // Ensure it doesn't start with 'system' (reserved)
  if (sanitized.startsWith("system")) {
    sanitized = "proj_" + sanitized;
  }

  return sanitized;
}

// Helper function to ensure unique project name
async function ensureUniqueProjectName(
  mongoClient: MongoClient,
  baseName: string,
  userId: string
): Promise<string> {
  const projectsCollection = mongoClient.db("basebase").collection("projects");

  let uniqueName = baseName;
  let counter = 1;

  while (true) {
    // Check if name exists for this user or globally (since it will be a DB name)
    const existingProject = await projectsCollection.findOne({
      _id: uniqueName,
    } as any);

    if (!existingProject) {
      return uniqueName;
    }

    // If name exists, try with counter
    uniqueName = `${baseName}_${counter}`;
    counter++;

    // Prevent infinite loop
    if (counter > 1000) {
      throw new Error("Unable to generate unique project name");
    }
  }
}

// JWT Authentication middleware
function authenticateToken(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN

  if (!token) {
    res.status(401).json({ error: "Access token required" });
    return;
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      res.status(403).json({ error: "Invalid or expired token" });
      return;
    }
    req.user = user as any; // Contains userId, projectId, projectName, phone
    next();
  });
}

// Helper function to validate phone number format
function validatePhoneFormat(phone: string): boolean {
  // Enforce strict +1234567890 format: + followed by 10-15 digits only
  const phoneRegex = /^\+\d{10,15}$/;
  return phoneRegex.test(phone);
}

// Helper function to generate verification code
function generateVerificationCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit code
}

// Helper function to get or create user
async function getOrCreateUser(
  mongoClient: MongoClient,
  username: string,
  phone: string
): Promise<User> {
  const usersCollection = mongoClient.db("basebase").collection("users");

  // Check if user already exists by phone
  let user = (await usersCollection.findOne({ phone })) as User | null;

  if (!user) {
    // Check if username already exists as _id
    const existingUserWithUsername = await usersCollection.findOne({
      _id: username,
    } as any);

    if (existingUserWithUsername) {
      throw new Error("Username already exists");
    }

    // Create new user with username as _id
    const newUser: any = {
      _id: username,
      name: "New User",
      phone,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await usersCollection.insertOne(newUser);
    user = (await usersCollection.findOne({
      _id: newUser._id,
    } as any)) as User | null;
  }

  return user!;
}

// Helper function to store verification code
async function storeVerificationCode(
  mongoClient: MongoClient,
  phone: string,
  code: string
): Promise<void> {
  const codesCollection = mongoClient
    .db("basebase")
    .collection("verification_codes");

  // Remove any existing codes for this phone
  await codesCollection.deleteMany({ phone });

  // Store new code with expiration (5 minutes)
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  await codesCollection.insertOne({
    phone,
    code,
    expiresAt,
    createdAt: new Date(),
  });
}

// Helper function to verify code
async function verifyCode(
  mongoClient: MongoClient,
  phone: string,
  code: string
): Promise<boolean> {
  const codesCollection = mongoClient
    .db("basebase")
    .collection("verification_codes");

  const storedCode = (await codesCollection.findOne({
    phone,
    code,
    expiresAt: { $gt: new Date() },
  })) as VerificationCode | null;

  if (storedCode) {
    // Clean up used code
    await codesCollection.deleteOne({ _id: storedCode._id! });
    return true;
  }

  return false;
}

// Helper function to verify project API key
async function verifyProjectApiKey(
  mongoClient: MongoClient,
  projectApiKey: string
): Promise<Project | null> {
  const projectsCollection = mongoClient.db("basebase").collection("projects");

  const project = (await projectsCollection.findOne({
    apiKey: projectApiKey,
  })) as unknown as Project | null;
  return project;
}

// Helper function to verify project by ID
async function verifyProjectId(
  mongoClient: MongoClient,
  projectId: string
): Promise<Project | null> {
  const projectsCollection = mongoClient.db("basebase").collection("projects");

  const project = (await projectsCollection.findOne({
    _id: projectId,
  } as any)) as unknown as Project | null;
  return project;
}

// Helper function to send SMS via Twilio
async function sendSMS(
  phone: string,
  message: string
): Promise<{ success: boolean; messageId: string }> {
  try {
    const result = await twilioClient.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER!,
      to: phone,
    });

    console.log(
      `SMS sent successfully to ${phone}. Message SID: ${result.sid}`
    );
    return { success: true, messageId: result.sid };
  } catch (error) {
    console.error("Twilio SMS error:", error);
    throw new Error(`Failed to send SMS: ${(error as Error).message}`);
  }
}

// Request verification code endpoint
async function requestCodeHandler(
  req: Request,
  res: Response,
  mongoClient: MongoClient
): Promise<void> {
  try {
    const { username, phone } = req.body;

    if (!username || !phone) {
      res.status(400).json({ error: "Username and phone are required" });
      return;
    }

    // Phone validation - enforce strict +1234567890 format
    if (!validatePhoneFormat(phone)) {
      res.status(400).json({
        error:
          "Invalid phone number format. Phone must be in format +1234567890 (+ followed by 10-15 digits only)",
      });
      return;
    }

    // Create or get user
    const user = await getOrCreateUser(mongoClient, username, phone);

    // Generate verification code
    const code = generateVerificationCode();

    // Store code
    await storeVerificationCode(mongoClient, phone, code);

    // Send SMS with verification code
    const message = `Your BaseBase verification code is: ${code}. This code expires in 5 minutes.`;

    try {
      await sendSMS(phone, message);

      res.json({
        message: "Verification code sent via SMS",
        userId: user._id?.toString(),
      });
    } catch (smsError) {
      console.error("SMS sending failed:", smsError);

      // For development - fallback to console log if SMS fails
      console.log(`Verification code for ${phone}: ${code}`);

      res.status(500).json({
        error:
          "Failed to send SMS. Please check your phone number and try again.",
        // Include code only in development for debugging
        ...(process.env.NODE_ENV === "development" && { code: code }),
      });
    }
  } catch (error) {
    console.error("Request code error:", error);

    if ((error as Error).message === "Username already exists") {
      res.status(400).json({ error: "Username already exists" });
    } else {
      res.status(500).json({ error: "Failed to request verification code" });
    }
  }
}

// Verify code and get JWT endpoint
async function verifyCodeHandler(
  req: Request,
  res: Response,
  mongoClient: MongoClient
): Promise<void> {
  try {
    const { phone, code, projectId } = req.body;

    console.log("=== VERIFY CODE DEBUG ===");
    console.log("Request body:", {
      phone,
      code: code ? "[REDACTED]" : undefined,
      projectId: projectId ? "[REDACTED]" : undefined,
    });

    if (!phone || !code || !projectId) {
      console.log("Missing required fields:", {
        hasPhone: !!phone,
        hasCode: !!code,
        hasProjectId: !!projectId,
      });
      res
        .status(400)
        .json({ error: "Phone, code, and projectId are required" });
      return;
    }

    // Phone validation - enforce strict +1234567890 format
    if (!validatePhoneFormat(phone)) {
      console.log("Invalid phone format:", phone);
      res.status(400).json({
        error:
          "Invalid phone number format. Phone must be in format +1234567890 (+ followed by 10-15 digits only)",
      });
      return;
    }

    console.log("Phone format valid:", phone);

    // Check what codes exist for this phone
    const codesCollection = mongoClient
      .db("basebase")
      .collection("verification_codes");
    const allCodesForPhone = await codesCollection.find({ phone }).toArray();
    console.log(
      "All codes for phone:",
      allCodesForPhone.map((c) => ({
        code: c.code,
        expiresAt: c.expiresAt,
        isExpired: c.expiresAt <= new Date(),
        createdAt: c.createdAt,
      }))
    );

    // Verify the code
    const isValidCode = await verifyCode(mongoClient, phone, code);
    console.log("Code verification result:", isValidCode);

    if (!isValidCode) {
      console.log("Code verification failed for phone:", phone, "code:", code);
      res.status(400).json({ error: "Invalid or expired verification code" });
      return;
    }

    // Verify project ID
    const project = await verifyProjectId(mongoClient, projectId);
    console.log(
      "Project verification result:",
      project ? "found" : "not found"
    );

    if (!project) {
      console.log("Invalid project ID");
      res.status(400).json({ error: "Invalid project ID" });
      return;
    }

    // Get user
    const user = (await mongoClient
      .db("basebase")
      .collection("users")
      .findOne({ phone })) as User | null;
    console.log("User lookup result:", user ? "found" : "not found");

    if (!user) {
      console.log("User not found for phone:", phone);
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Generate JWT token
    console.log(
      "Generating JWT token for user:",
      user._id,
      "project:",
      project._id
    );

    const token = jwt.sign(
      {
        userId: user._id,
        projectId: project._id,
        projectName: project._id,
      },
      JWT_SECRET,
      { expiresIn: "1y" }
    );

    console.log("JWT token generated successfully");
    console.log("=== VERIFY CODE SUCCESS ===");

    res.json({
      token,
      user: {
        name: `users/${user._id}`,
        fields: {
          name: { stringValue: user.name },
          phone: { stringValue: user.phone },
          createdAt: {
            timestampValue: user.createdAt
              ? user.createdAt.toISOString()
              : new Date().toISOString(),
          },
          updatedAt: {
            timestampValue: user.updatedAt
              ? user.updatedAt.toISOString()
              : new Date().toISOString(),
          },
        },
      } as FirestoreUser,
      project: {
        name: `projects/${project._id}`,
        fields: {
          name: { stringValue: project.name },
          description: { stringValue: project.description || "" },
          ownerId: { stringValue: project.ownerId },
          createdAt: {
            timestampValue: project.createdAt
              ? project.createdAt.toISOString()
              : new Date().toISOString(),
          },
          updatedAt: {
            timestampValue: project.updatedAt
              ? project.updatedAt.toISOString()
              : new Date().toISOString(),
          },
        },
      } as FirestoreProject,
    });
  } catch (error) {
    console.error("Verify code error:", error);
    console.log("=== VERIFY CODE ERROR ===");
    res.status(500).json({ error: "Failed to verify code" });
  }
}

// Create project endpoint
async function createProjectHandler(
  req: AuthenticatedRequest,
  res: Response,
  mongoClient: MongoClient
): Promise<void> {
  try {
    const { name, description } = req.body;
    const userId = req.user!.userId;

    if (!name) {
      res.status(400).json({ error: "Project name is required" });
      return;
    }

    // Sanitize project name
    let sanitizedName: string;
    try {
      sanitizedName = sanitizeProjectName(name);
    } catch (sanitizeError) {
      res.status(400).json({
        error: `Invalid project name: ${(sanitizeError as Error).message}`,
      });
      return;
    }

    // Ensure unique sanitized name
    try {
      sanitizedName = await ensureUniqueProjectName(
        mongoClient,
        sanitizedName,
        userId
      );
    } catch (uniqueError) {
      res.status(400).json({
        error: `Unable to create unique project name: ${
          (uniqueError as Error).message
        }`,
      });
      return;
    }

    // Generate API key
    const apiKey = generateApiKey();

    // Create project
    const newProject: Project = {
      _id: sanitizedName, // Use sanitized name as _id for database operations
      name: name.trim(), // Store original name for display
      description: description || "",
      ownerId: userId,
      apiKey,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const projectsCollection = mongoClient
      .db("basebase")
      .collection("projects");

    await projectsCollection.insertOne(newProject as any);
    const project = (await projectsCollection.findOne({
      _id: newProject._id,
    } as any)) as unknown as Project;

    res.status(201).json({
      project: {
        name: `projects/${project._id}`,
        fields: {
          name: { stringValue: project.name },
          description: { stringValue: project.description || "" },
          ownerId: { stringValue: project.ownerId },
          createdAt: { timestampValue: project.createdAt.toISOString() },
          updatedAt: { timestampValue: project.updatedAt.toISOString() },
        },
      } as FirestoreProject,
      apiKey: project.apiKey,
      warning:
        "⚠️  IMPORTANT: Store this API key securely! It cannot be retrieved again.",
      note: `Database name will be: ${project._id}`,
    });
  } catch (error) {
    console.error("Create project error:", error);
    if ((error as any).code === 11000) {
      res.status(400).json({
        error: "Project name already exists. Please choose a different name.",
      });
      return;
    }
    res.status(500).json({ error: "Failed to create project" });
  }
}

// List projects endpoint
async function listProjectsHandler(
  req: AuthenticatedRequest,
  res: Response,
  mongoClient: MongoClient
): Promise<void> {
  try {
    const userId = req.user!.userId;

    const projectsCollection = mongoClient
      .db("basebase")
      .collection("projects");
    const projects = (await projectsCollection
      .find({ ownerId: userId })
      .project({ apiKey: 0 }) // Never return API keys in list
      .toArray()) as Project[];

    const projectList: FirestoreProject[] = projects.map((project) => ({
      name: `projects/${project._id}`,
      fields: {
        name: { stringValue: project.name },
        description: { stringValue: project.description || "" },
        ownerId: { stringValue: project.ownerId },
        createdAt: { timestampValue: project.createdAt.toISOString() },
        updatedAt: { timestampValue: project.updatedAt.toISOString() },
      },
    }));

    res.json({
      projects: projectList,
      count: projectList.length,
    });
  } catch (error) {
    console.error("List projects error:", error);
    res.status(500).json({ error: "Failed to list projects" });
  }
}

// Regenerate API key endpoint
async function regenerateApiKeyHandler(
  req: AuthenticatedRequest,
  res: Response,
  mongoClient: MongoClient
): Promise<void> {
  try {
    const { projectId } = req.params;
    const userId = req.user!.userId;

    const projectsCollection = mongoClient
      .db("basebase")
      .collection("projects");

    // Check if project exists and user owns it
    const project = (await projectsCollection.findOne({
      _id: projectId,
      ownerId: userId,
    } as any)) as unknown as Project | null;

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    // Generate new API key
    const newApiKey = generateApiKey();

    // Update project with new API key
    await projectsCollection.updateOne({ _id: project._id } as any, {
      $set: {
        apiKey: newApiKey,
        updatedAt: new Date(),
      },
    });

    res.json({
      project: {
        name: `projects/${project._id}`,
        fields: {
          name: { stringValue: project.name },
          description: { stringValue: project.description || "" },
          ownerId: { stringValue: project.ownerId },
          createdAt: { timestampValue: project.createdAt.toISOString() },
          updatedAt: { timestampValue: project.updatedAt.toISOString() },
        },
      } as FirestoreProject,
      apiKey: newApiKey,
      warning:
        "⚠️  IMPORTANT: Store this API key securely! It cannot be retrieved again.",
      note: "🔄 Previous API key has been invalidated.",
    });
  } catch (error) {
    console.error("Regenerate API key error:", error);
    res.status(500).json({ error: "Failed to regenerate API key" });
  }
}

// Setup authentication routes
function setupAuthRoutes(
  app: Express,
  mongoClient: MongoClient,
  checkConnection: (req: Request, res: Response, next: NextFunction) => void
): void {
  // Request verification code
  app.post(
    "/v1/requestCode",
    checkConnection,
    async (req: Request, res: Response) => {
      await requestCodeHandler(req, res, mongoClient);
    }
  );

  // Verify code and get JWT
  app.post(
    "/v1/verifyCode",
    checkConnection,
    async (req: Request, res: Response) => {
      await verifyCodeHandler(req, res, mongoClient);
    }
  );

  // Project management routes (require JWT)
  app.post(
    "/v1/projects",
    checkConnection,
    authenticateToken,
    async (req: AuthenticatedRequest, res: Response) => {
      await createProjectHandler(req, res, mongoClient);
    }
  );

  app.get(
    "/v1/projects",
    checkConnection,
    authenticateToken,
    async (req: AuthenticatedRequest, res: Response) => {
      await listProjectsHandler(req, res, mongoClient);
    }
  );

  app.post(
    "/v1/projects/:projectId/regenerate-key",
    checkConnection,
    authenticateToken,
    async (req: AuthenticatedRequest, res: Response) => {
      await regenerateApiKeyHandler(req, res, mongoClient);
    }
  );
}

export { authenticateToken, setupAuthRoutes, JWT_SECRET };
