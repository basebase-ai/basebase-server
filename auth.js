const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const JWT_SECRET =
  process.env.JWT_SECRET || "your-secret-key-change-in-production";

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
    req.user = user; // Contains userId and projectId
    next();
  });
}

// Helper function to generate verification code
function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit code
}

// Helper function to get or create user
async function getOrCreateUser(mongoClient, name, phone) {
  const usersCollection = mongoClient.db("basebase").collection("users");

  // Check if user already exists
  let user = await usersCollection.findOne({ phone });

  if (!user) {
    // Create new user
    const newUser = {
      name,
      phone,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await usersCollection.insertOne(newUser);
    user = await usersCollection.findOne({ _id: result.insertedId });
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

// Request verification code endpoint
async function requestCodeHandler(req, res, mongoClient) {
  try {
    const { username, phone } = req.body;

    if (!username || !phone) {
      return res.status(400).json({ error: "Username and phone are required" });
    }

    // Phone validation (basic)
    const phoneRegex = /^\+?[\d\s\-\(\)]+$/;
    if (!phoneRegex.test(phone)) {
      return res.status(400).json({ error: "Invalid phone number format" });
    }

    // Create or get user
    const user = await getOrCreateUser(mongoClient, username, phone);

    // Generate verification code
    const code = generateVerificationCode();

    // Store code
    await storeVerificationCode(mongoClient, phone, code);

    // In production, you would send this code via SMS
    // For development, we'll return it (remove this in production!)
    console.log(`Verification code for ${phone}: ${code}`);

    res.json({
      message: "Verification code sent",
      userId: user._id.toString(),
      // Remove in production:
      code: code,
    });
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
        userId: user._id.toString(),
        projectId: project._id.toString(),
        phone: user.phone,
      },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    res.json({
      token,
      user: {
        id: user._id.toString(),
        name: user.name,
        phone: user.phone,
      },
      project: {
        id: project._id.toString(),
        name: project.name,
      },
    });
  } catch (error) {
    console.error("Verify code error:", error);
    res.status(500).json({ error: "Failed to verify code" });
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
}

module.exports = {
  authenticateToken,
  setupAuthRoutes,
  JWT_SECRET,
};
