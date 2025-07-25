import { ServerClient } from "postmark";

// Postmark client instance for server functions
let postmarkClient: ServerClient | null = null;

/**
 * Initialize Postmark client for server functions
 * Returns null in test environment or if credentials are missing
 */
export function getPostmarkClient(): ServerClient | null {
  // Return null in test environment
  if (process.env.NODE_ENV === "test") {
    return null;
  }

  // Check if required environment variables are set
  if (!process.env.POSTMARK_API_KEY) {
    console.warn(
      "Postmark API key not configured. Email functions will not work."
    );
    return null;
  }

  // Initialize client if not already created
  if (!postmarkClient) {
    try {
      postmarkClient = new ServerClient(process.env.POSTMARK_API_KEY!);
      console.log("✅ Postmark client initialized for server functions");
    } catch (error) {
      console.error("❌ Failed to initialize Postmark client:", error);
      return null;
    }
  }

  return postmarkClient;
}

/**
 * Get the configured Postmark sender email/name
 */
export function getPostmarkFromEmail(): string | null {
  return process.env.POSTMARK_FROM_EMAIL || null;
}

/**
 * Get the configured Postmark sender name (optional)
 */
export function getPostmarkFromName(): string | null {
  return process.env.POSTMARK_FROM_NAME || null;
}
