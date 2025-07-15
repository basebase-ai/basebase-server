"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JWT_SECRET = void 0;
exports.authenticateToken = authenticateToken;
exports.setupAuthRoutes = setupAuthRoutes;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = __importDefault(require("crypto"));
const twilio_1 = __importDefault(require("twilio"));
// Initialize Twilio client
const twilioClient = (0, twilio_1.default)(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key-change-in-production";
exports.JWT_SECRET = JWT_SECRET;
// Helper function to generate secure API key
function generateApiKey() {
    return "bb_" + crypto_1.default.randomBytes(32).toString("hex");
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
            _id: uniqueName,
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
        res.status(401).json({ error: "Access token required" });
        return;
    }
    jsonwebtoken_1.default.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            res.status(403).json({ error: "Invalid or expired token" });
            return;
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
async function getOrCreateUser(mongoClient, username, phone) {
    const usersCollection = mongoClient.db("basebase").collection("users");
    // Check if user already exists by phone
    let user = (await usersCollection.findOne({ phone }));
    if (!user) {
        // Check if username already exists as _id
        const existingUserWithUsername = await usersCollection.findOne({
            _id: username,
        });
        if (existingUserWithUsername) {
            throw new Error("Username already exists");
        }
        // Create new user with username as _id
        const newUser = {
            _id: username,
            name: "New User",
            phone,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        await usersCollection.insertOne(newUser);
        user = (await usersCollection.findOne({
            _id: newUser._id,
        }));
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
    const storedCode = (await codesCollection.findOne({
        phone,
        code,
        expiresAt: { $gt: new Date() },
    }));
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
    const project = (await projectsCollection.findOne({
        apiKey: projectApiKey,
    }));
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
        console.log(`SMS sent successfully to ${phone}. Message SID: ${result.sid}`);
        return { success: true, messageId: result.sid };
    }
    catch (error) {
        console.error("Twilio SMS error:", error);
        throw new Error(`Failed to send SMS: ${error.message}`);
    }
}
// Request verification code endpoint
async function requestCodeHandler(req, res, mongoClient) {
    try {
        const { username, phone } = req.body;
        if (!username || !phone) {
            res.status(400).json({ error: "Username and phone are required" });
            return;
        }
        // Phone validation - enforce strict +1234567890 format
        if (!validatePhoneFormat(phone)) {
            res.status(400).json({
                error: "Invalid phone number format. Phone must be in format +1234567890 (+ followed by 10-15 digits only)",
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
        }
        catch (smsError) {
            console.error("SMS sending failed:", smsError);
            // For development - fallback to console log if SMS fails
            console.log(`Verification code for ${phone}: ${code}`);
            res.status(500).json({
                error: "Failed to send SMS. Please check your phone number and try again.",
                // Include code only in development for debugging
                ...(process.env.NODE_ENV === "development" && { code: code }),
            });
        }
    }
    catch (error) {
        console.error("Request code error:", error);
        if (error.message === "Username already exists") {
            res.status(400).json({ error: "Username already exists" });
        }
        else {
            res.status(500).json({ error: "Failed to request verification code" });
        }
    }
}
// Verify code and get JWT endpoint
async function verifyCodeHandler(req, res, mongoClient) {
    try {
        const { phone, code, projectApiKey } = req.body;
        console.log("=== VERIFY CODE DEBUG ===");
        console.log("Request body:", {
            phone,
            code: code ? "[REDACTED]" : undefined,
            projectApiKey: projectApiKey ? "[REDACTED]" : undefined,
        });
        if (!phone || !code || !projectApiKey) {
            console.log("Missing required fields:", {
                hasPhone: !!phone,
                hasCode: !!code,
                hasProjectApiKey: !!projectApiKey,
            });
            res
                .status(400)
                .json({ error: "Phone, code, and projectApiKey are required" });
            return;
        }
        // Phone validation - enforce strict +1234567890 format
        if (!validatePhoneFormat(phone)) {
            console.log("Invalid phone format:", phone);
            res.status(400).json({
                error: "Invalid phone number format. Phone must be in format +1234567890 (+ followed by 10-15 digits only)",
            });
            return;
        }
        console.log("Phone format valid:", phone);
        // Check what codes exist for this phone
        const codesCollection = mongoClient
            .db("basebase")
            .collection("verification_codes");
        const allCodesForPhone = await codesCollection.find({ phone }).toArray();
        console.log("All codes for phone:", allCodesForPhone.map((c) => ({
            code: c.code,
            expiresAt: c.expiresAt,
            isExpired: c.expiresAt <= new Date(),
            createdAt: c.createdAt,
        })));
        // Verify the code
        const isValidCode = await verifyCode(mongoClient, phone, code);
        console.log("Code verification result:", isValidCode);
        if (!isValidCode) {
            console.log("Code verification failed for phone:", phone, "code:", code);
            res.status(400).json({ error: "Invalid or expired verification code" });
            return;
        }
        // Verify project API key
        const project = await verifyProjectApiKey(mongoClient, projectApiKey);
        console.log("Project verification result:", project ? "found" : "not found");
        if (!project) {
            console.log("Invalid project API key");
            res.status(400).json({ error: "Invalid project API key" });
            return;
        }
        // Get user
        const user = (await mongoClient
            .db("basebase")
            .collection("users")
            .findOne({ phone }));
        console.log("User lookup result:", user ? "found" : "not found");
        if (!user) {
            console.log("User not found for phone:", phone);
            res.status(404).json({ error: "User not found" });
            return;
        }
        // Generate JWT token
        console.log("Generating JWT token for user:", user._id, "project:", project._id);
        const token = jsonwebtoken_1.default.sign({
            userId: user._id,
            projectId: project._id,
            projectName: project._id,
        }, JWT_SECRET, { expiresIn: "1y" });
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
            },
            project: {
                name: `projects/${project._id}`,
                fields: {
                    displayName: { stringValue: project.displayName },
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
            },
        });
    }
    catch (error) {
        console.error("Verify code error:", error);
        console.log("=== VERIFY CODE ERROR ===");
        res.status(500).json({ error: "Failed to verify code" });
    }
}
// Create project endpoint
async function createProjectHandler(req, res, mongoClient) {
    try {
        const { name, description } = req.body;
        const userId = req.user.userId;
        if (!name) {
            res.status(400).json({ error: "Project name is required" });
            return;
        }
        // Sanitize project name
        let sanitizedName;
        try {
            sanitizedName = sanitizeProjectName(name);
        }
        catch (sanitizeError) {
            res.status(400).json({
                error: `Invalid project name: ${sanitizeError.message}`,
            });
            return;
        }
        // Ensure unique sanitized name
        try {
            sanitizedName = await ensureUniqueProjectName(mongoClient, sanitizedName, userId);
        }
        catch (uniqueError) {
            res.status(400).json({
                error: `Unable to create unique project name: ${uniqueError.message}`,
            });
            return;
        }
        // Generate API key
        const apiKey = generateApiKey();
        // Create project
        const newProject = {
            _id: sanitizedName, // Use sanitized name as _id for database operations
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
        // Create unique index on _id if it doesn't exist
        try {
            await projectsCollection.createIndex({ _id: 1 }, { unique: true });
        }
        catch (indexError) {
            // Index might already exist, that's fine
            console.log("Projects _id index creation info:", indexError.message);
        }
        await projectsCollection.insertOne(newProject);
        const project = (await projectsCollection.findOne({
            _id: newProject._id,
        }));
        res.status(201).json({
            project: {
                name: `projects/${project._id}`,
                fields: {
                    displayName: { stringValue: project.displayName },
                    description: { stringValue: project.description || "" },
                    ownerId: { stringValue: project.ownerId },
                    createdAt: { timestampValue: project.createdAt.toISOString() },
                    updatedAt: { timestampValue: project.updatedAt.toISOString() },
                },
            },
            apiKey: project.apiKey,
            warning: "⚠️  IMPORTANT: Store this API key securely! It cannot be retrieved again.",
            note: `Database name will be: ${project._id}`,
        });
    }
    catch (error) {
        console.error("Create project error:", error);
        if (error.code === 11000) {
            res.status(400).json({
                error: "Project name already exists. Please choose a different name.",
            });
            return;
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
        const projects = (await projectsCollection
            .find({ ownerId: userId })
            .project({ apiKey: 0 }) // Never return API keys in list
            .toArray());
        const projectList = projects.map((project) => ({
            name: `projects/${project._id}`,
            fields: {
                displayName: { stringValue: project.displayName },
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
    }
    catch (error) {
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
        const project = (await projectsCollection.findOne({
            _id: projectId,
            ownerId: userId,
        }));
        if (!project) {
            res.status(404).json({ error: "Project not found" });
            return;
        }
        // Generate new API key
        const newApiKey = generateApiKey();
        // Update project with new API key
        await projectsCollection.updateOne({ _id: project._id }, {
            $set: {
                apiKey: newApiKey,
                updatedAt: new Date(),
            },
        });
        res.json({
            project: {
                name: `projects/${project._id}`,
                fields: {
                    displayName: { stringValue: project.displayName },
                    description: { stringValue: project.description || "" },
                    ownerId: { stringValue: project.ownerId },
                    createdAt: { timestampValue: project.createdAt.toISOString() },
                    updatedAt: { timestampValue: project.updatedAt.toISOString() },
                },
            },
            apiKey: newApiKey,
            warning: "⚠️  IMPORTANT: Store this API key securely! It cannot be retrieved again.",
            note: "🔄 Previous API key has been invalidated.",
        });
    }
    catch (error) {
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
    app.post("/projects", checkConnection, authenticateToken, async (req, res) => {
        await createProjectHandler(req, res, mongoClient);
    });
    app.get("/projects", checkConnection, authenticateToken, async (req, res) => {
        await listProjectsHandler(req, res, mongoClient);
    });
    app.post("/projects/:projectId/regenerate-key", checkConnection, authenticateToken, async (req, res) => {
        await regenerateApiKeyHandler(req, res, mongoClient);
    });
}
