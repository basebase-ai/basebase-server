module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  testTimeout: 60000, // Increase timeout to 60 seconds
  maxWorkers: 1, // Run tests sequentially to avoid MongoDB conflicts
  forceExit: true, // Force exit after tests complete
  detectOpenHandles: true, // Help debug hanging tests

  // Cleaner output configuration
  verbose: false, // Reduce noise
  silent: false, // Keep this false so we can see important logs
  reporters: ["default"],

  // Test matching
  testMatch: [
    "**/__tests__/**/*.test.ts",
    "**/__tests__/**/*.test.js",
    "**/*.test.ts",
    "**/*.test.js",
  ],
  testPathIgnorePatterns: ["/node_modules/", "/dist/", "test-utils"],

  // Better error handling
  errorOnDeprecated: true,
  collectCoverage: false, // Set to true if you want coverage

  // Better output formatting
  clearMocks: true,
  restoreMocks: true,

  // Show only failures and summary by default
  noStackTrace: false, // Keep stack traces for debugging
  bail: false, // Continue running tests even if some fail
};
