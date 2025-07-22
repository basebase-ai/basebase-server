import twilio from "twilio";

// Twilio client instance for server functions
let twilioClient: twilio.Twilio | null = null;

/**
 * Initialize Twilio client for server functions
 * Returns null in test environment or if credentials are missing
 */
export function getTwilioClient(): twilio.Twilio | null {
  // Return null in test environment
  if (process.env.NODE_ENV === "test") {
    return null;
  }

  // Check if required environment variables are set
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    console.warn(
      "Twilio credentials not configured. SMS functions will not work."
    );
    return null;
  }

  // Initialize client if not already created
  if (!twilioClient) {
    try {
      twilioClient = twilio(
        process.env.TWILIO_ACCOUNT_SID!,
        process.env.TWILIO_AUTH_TOKEN!
      );
      console.log("✅ Twilio client initialized for server functions");
    } catch (error) {
      console.error("❌ Failed to initialize Twilio client:", error);
      return null;
    }
  }

  return twilioClient;
}

/**
 * Get the configured Twilio phone number
 */
export function getTwilioPhoneNumber(): string | null {
  return process.env.TWILIO_PHONE_NUMBER || null;
}
