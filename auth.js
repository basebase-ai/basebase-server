const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const twilio = require("twilio");

// Helper function to generate 72-bit base64 _name ID (same as server.js)
function generateName() {
  // Generate 9 bytes (72 bits) of random data
  const randomBytes = crypto.randomBytes(9);
  // Convert to base64 and make URL-safe
  return randomBytes.toString('base64url');
}

// Initialize Twilio client
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const JWT_SECRET =
  process.env.JWT_SECRET || "your-secret-key-change-in-production";

// Helper function to generate secure API key
function generateApiKey() {
  return "bb_" + crypto.randomBytes(32).toString("hex");
}

// Helper function to sanitize project name for MongoDB database name
function sanitizeProjectName(name) {
  if (!name || typeof name !== "string") {
    throw new Error("Project name must be a non-empty string");
  }

  // Convert to lowercase and remove whitespace
  let sanitized = name.toLowerCase().trim();

  // Replace spaces and invalid characters with underscores
  sanitized = sanitized.replace(/[\s\/\\\.\"*<>:|?$]/g, "_");

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
async function ensureUniqueProjectName(mongoClient, baseName, userId) {
  const projectsCollection = mongoClient.db("basebase").collection("projects");

  let uniqueName = baseName;
  let counter = 1;

  while (true) {
    // Check if name exists for this user or globally (since it will be a DB name)
    const existingProject = await projectsCollection.findOne({
      _name: uniqueName,
    });

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
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: "Access token required" });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: "Invalid or expired token" });
    }
    req.user = user; // Contains userId, projectId, projectName, phone
    next();
  });
}

// Helper function to validate phone number format
function validatePhoneFormat(phone) {
  // Enforce strict +1234567890 format: + followed by 10-15 digits only
  const phoneRegex = /^\+\d{10,15}$/;
  return phoneRegex.test(phone);
}

// Helper function to generate verification code
function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit code
}

// Helper function to get or create user
async function getOrCreateUser(mongoClient, name, phone) {
  const usersCollection = mongoClient.db("basebase").collection("users");

  // Create unique index on _name if it doesn't exist
  try {
    await usersCollection.createIndex({ _name: 1 }, { unique: true });
  } catch (indexError) {
    // Index might already exist, that's fine
    console.log("Users _name index creation info:", indexError.message);
  }

  // Check if user already exists
  let user = await usersCollection.findOne({ phone });

  if (!user) {
    // Generate unique _name for user
    let userName;
    const maxAttempts = 10;
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      userName = generateName();
      
      // Check if _name already exists
      const existingUser = await usersCollection.findOne({ _name: userName });
      if (!existingUser) {
        break;
      }
      
      if (attempt === maxAttempts - 1) {
        throw new Error("Failed to generate unique _name for user after multiple attempts");
      }
    }

    // Create new user
    const newUser = {
      _name: userName,
      name,
      phone,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await usersCollection.insertOne(newUser);
    user = await usersCollection.findOne({ _name: newUser._name });
  }

  return user;
}

// Helper function to store verification code
async function storeVerificationCode(mongoClient, phone, code) {
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
async function verifyCode(mongoClient, phone, code) {
  const codesCollection = mongoClient
    .db("basebase")
    .collection("verification_codes");

  const storedCode = await codesCollection.findOne({
    phone,
    code,
    expiresAt: { $gt: new Date() },
  });

  if (storedCode) {
    // Clean up used code
    await codesCollection.deleteOne({ _id: storedCode._id });
    return true;
  }

  return false;
}

// Helper function to verify project API key
async function verifyProjectApiKey(mongoClient, projectApiKey) {
  const projectsCollection = mongoClient.db("basebase").collection("projects");

  const project = await projectsCollection.findOne({ apiKey: projectApiKey });
  return project;
}

// Helper function to send SMS via Twilio
async function sendSMS(phone, message) {
  try {
    const result = await twilioClient.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phone,
    });

    console.log(
      `SMS sent successfully to ${phone}. Message SID: ${result.sid}`
    );
    return { success: true, messageId: result.sid };
  } catch (error) {
    console.error("Twilio SMS error:", error);
    throw new Error(`Failed to send SMS: ${error.message}`);
  }
}

// Request verification code endpoint
async function requestCodeHandler(req, res, mongoClient) {
  try {
    const { name, phone } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ error: "Name and phone are required" });
    }

    // Phone validation - enforce strict +1234567890 format
    if (!validatePhoneFormat(phone)) {
      return res.status(400).json({
        error:
          "Invalid phone number format. Phone must be in format +1234567890 (+ followed by 10-15 digits only)",
      });
    }

    // Create or get user
    const user = await getOrCreateUser(mongoClient, name, phone);

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
        userId: user._id.toString(),
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
    res.status(500).json({ error: "Failed to request verification code" });
  }
}

// Verify code and get JWT endpoint
async function verifyCodeHandler(req, res, mongoClient) {
  try {
    const { phone, code, projectApiKey } = req.body;

    if (!phone || !code || !projectApiKey) {
      return res
        .status(400)
        .json({ error: "Phone, code, and projectApiKey are required" });
    }

    // Phone validation - enforce strict +1234567890 format
    if (!validatePhoneFormat(phone)) {
      return res.status(400).json({
        error:
          "Invalid phone number format. Phone must be in format +1234567890 (+ followed by 10-15 digits only)",
      });
    }

    // Verify the code
    const isValidCode = await verifyCode(mongoClient, phone, code);
    if (!isValidCode) {
      return res
        .status(400)
        .json({ error: "Invalid or expired verification code" });
    }

    // Verify project API key
    const project = await verifyProjectApiKey(mongoClient, projectApiKey);
    if (!project) {
      return res.status(400).json({ error: "Invalid project API key" });
    }

    // Get user
    const user = await mongoClient
      .db("basebase")
      .collection("users")
      .findOne({ phone });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        userId: user._name,
        projectId: project._name,
        projectName: project._name,
      },
      JWT_SECRET,
      { expiresIn: "1y" }
    );

    res.json({
      token,
      user: {
        name: `users/${user._name}`,
        fields: {
          name: { stringValue: user.name },
          phone: { stringValue: user.phone },
          createdAt: { timestampValue: user.createdAt.toISOString() },
          updatedAt: { timestampValue: user.updatedAt.toISOString() }
        }
      },
      project: {
        name: `projects/${project._name}`,
        fields: {
          displayName: { stringValue: project.displayName },
          description: { stringValue: project.description || "" },
          ownerId: { stringValue: project.ownerId },
          createdAt: { timestampValue: project.createdAt.toISOString() },
          updatedAt: { timestampValue: project.updatedAt.toISOString() }
        }
      },
    });
  } catch (error) {
    console.error("Verify code error:", error);
    res.status(500).json({ error: "Failed to verify code" });
  }
}

// Create project endpoint
async function createProjectHandler(req, res, mongoClient) {
  try {
    const { name, description } = req.body;
    const userId = req.user.userId;

    if (!name) {
      return res.status(400).json({ error: "Project name is required" });
    }

    // Sanitize project name
    let sanitizedName;
    try {
      sanitizedName = sanitizeProjectName(name);
    } catch (sanitizeError) {
      return res.status(400).json({
        error: `Invalid project name: ${sanitizeError.message}`,
      });
    }

    // Ensure unique sanitized name
    try {
      sanitizedName = await ensureUniqueProjectName(
        mongoClient,
        sanitizedName,
        userId
      );
    } catch (uniqueError) {
      return res.status(400).json({
        error: `Unable to create unique project name: ${uniqueError.message}`,
      });
    }

    // Generate API key
    const apiKey = generateApiKey();

    // Create project
    const newProject = {
      _name: sanitizedName, // Use sanitized name as _name for database operations
      displayName: name.trim(), // Store original name for display
      description: description || "",
      ownerId: userId,
      apiKey,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const projectsCollection = mongoClient
      .db("basebase")
      .collection("projects");

    // Create unique index on _name if it doesn't exist
    try {
      await projectsCollection.createIndex({ _name: 1 }, { unique: true });
    } catch (indexError) {
      // Index might already exist, that's fine
      console.log("Projects _name index creation info:", indexError.message);
    }

    const result = await projectsCollection.insertOne(newProject);
    const project = await projectsCollection.findOne({
      _name: newProject._name,
    });

    res.status(201).json({
      project: {
        name: `projects/${project._name}`,
        fields: {
          displayName: { stringValue: project.displayName },
          description: { stringValue: project.description || "" },
          ownerId: { stringValue: project.ownerId },
          createdAt: { timestampValue: project.createdAt.toISOString() },
          updatedAt: { timestampValue: project.updatedAt.toISOString() }
        }
      },
      apiKey: project.apiKey,
      warning:
        "⚠️  IMPORTANT: Store this API key securely! It cannot be retrieved again.",
      note: `Database name will be: ${project._name}`,
    });
  } catch (error) {
    console.error("Create project error:", error);
    if (error.code === 11000) {
      return res.status(400).json({
        error: "Project name already exists. Please choose a different name.",
      });
    }
    res.status(500).json({ error: "Failed to create project" });
  }
}

// List projects endpoint
async function listProjectsHandler(req, res, mongoClient) {
  try {
    const userId = req.user.userId;

    const projectsCollection = mongoClient
      .db("basebase")
      .collection("projects");
    const projects = await projectsCollection
      .find({ ownerId: userId })
      .project({ apiKey: 0 }) // Never return API keys in list
      .toArray();

    const projectList = projects.map((project) => ({
      name: `projects/${project._name}`,
      fields: {
        displayName: { stringValue: project.displayName },
        name: { stringValue: project.name },
        description: { stringValue: project.description || "" },
        ownerId: { stringValue: project.ownerId },
        createdAt: { timestampValue: project.createdAt.toISOString() },
        updatedAt: { timestampValue: project.updatedAt.toISOString() }
      }
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
async function regenerateApiKeyHandler(req, res, mongoClient) {
  try {
    const { projectId } = req.params;
    const userId = req.user.userId;

    const projectsCollection = mongoClient
      .db("basebase")
      .collection("projects");

    // Check if project exists and user owns it
    const project = await projectsCollection.findOne({
      _name: projectId,
      ownerId: userId,
    });

    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    // Generate new API key
    const newApiKey = generateApiKey();

    // Update project with new API key
    await projectsCollection.updateOne(
      { _name: project._name },
      {
        $set: {
          apiKey: newApiKey,
          updatedAt: new Date(),
        },
      }
    );

    res.json({
      project: {
        name: `projects/${project._name}`,
        fields: {
          displayName: { stringValue: project.displayName },
          description: { stringValue: project.description || "" },
          ownerId: { stringValue: project.ownerId },
          createdAt: { timestampValue: project.createdAt.toISOString() },
          updatedAt: { timestampValue: project.updatedAt.toISOString() }
        }
      },
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
function setupAuthRoutes(app, mongoClient, checkConnection) {
  // Request verification code
  app.post("/requestCode", checkConnection, async (req, res) => {
    await requestCodeHandler(req, res, mongoClient);
  });

  // Verify code and get JWT
  app.post("/verifyCode", checkConnection, async (req, res) => {
    await verifyCodeHandler(req, res, mongoClient);
  });

  // Project management routes (require JWT)
  app.post(
    "/projects",
    checkConnection,
    authenticateToken,
    async (req, res) => {
      await createProjectHandler(req, res, mongoClient);
    }
  );

  app.get("/projects", checkConnection, authenticateToken, async (req, res) => {
    await listProjectsHandler(req, res, mongoClient);
  });

  app.post(
    "/projects/:projectId/regenerate-key",
    checkConnection,
    authenticateToken,
    async (req, res) => {
      await regenerateApiKeyHandler(req, res, mongoClient);
    }
  );
}

module.exports = {
  authenticateToken,
  setupAuthRoutes,
  JWT_SECRET,
};
