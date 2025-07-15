// Global test setup
require("dotenv").config({ path: ".env.test" });

// Set test timeout
jest.setTimeout(60000);

// Don't mock console for debugging
// global.console = {
//   ...console,
//   log: jest.fn(),
//   warn: jest.fn(),
//   error: jest.fn()
// };

// Mock Twilio for all tests
jest.mock("twilio", () => {
  return jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn().mockResolvedValue({
        sid: "test_message_sid",
        status: "queued",
      }),
    },
  }));
});

// Setup test environment variables
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-key";
process.env.TWILIO_ACCOUNT_SID = "test_account_sid";
process.env.TWILIO_AUTH_TOKEN = "test_auth_token";
process.env.TWILIO_PHONE_NUMBER = "+15551111111";

// Global test setup
beforeAll(async () => {
  // Any global setup needed
});

afterAll(async () => {
  // Any global cleanup needed
});
