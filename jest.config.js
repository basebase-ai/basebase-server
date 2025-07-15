module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  testTimeout: 60000, // Increase timeout to 60 seconds
  maxWorkers: 1, // Run tests sequentially to avoid MongoDB conflicts
  forceExit: true, // Force exit after tests complete
  detectOpenHandles: true, // Help debug hanging tests
  testMatch: [
    "**/__tests__/**/*.test.ts",
    "**/__tests__/**/*.test.js",
    "**/*.test.ts",
    "**/*.test.js",
  ],
  testPathIgnorePatterns: ["/node_modules/", "/dist/", "test-utils"],
};
