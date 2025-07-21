import { TestHelper } from "./test-utils";
import request from "supertest";
import nock from "nock";

describe("Server Functions Tests", () => {
  let testHelper: TestHelper;
  let userToken: string;

  beforeAll(async () => {
    testHelper = new TestHelper();
    await testHelper.setup();
  }, 30000);

  afterAll(async () => {
    await testHelper.teardown();
  }, 30000);

  beforeEach(async () => {
    // Create a fresh test project and user for each test
    await testHelper.createTestProject();
    userToken = await testHelper.createTestUser();
  });

  afterEach(async () => {
    await testHelper.cleanupTestData();
    nock.cleanAll(); // Clean up nock mocks
  });

  describe("Function Management", () => {
    test("should list available server functions", async () => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .get("/v1/functions");

      expect(response.status).toBe(200);
      expect(response.body.functions).toBeDefined();
      expect(response.body.count).toBeDefined();
      expect(Array.isArray(response.body.functions)).toBe(true);

      // Should include our default functions
      const functionNames = response.body.functions.map((f: any) => f.id);
      expect(functionNames).toContain("getPage");
      expect(functionNames).toContain("sendSms");
    });

    test("should get specific function details", async () => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .get("/v1/functions/getPage");

      expect(response.status).toBe(200);
      expect(response.body.id).toBe("getPage");
      expect(response.body.description).toBeDefined();
      expect(response.body.implementationCode).toBeDefined();
      expect(response.body.requiredServices).toContain("axios");
      expect(response.body.createdAt).toBeDefined();
      expect(response.body.updatedAt).toBeDefined();
    });

    test("should return 404 for non-existent function", async () => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .get("/v1/functions/nonExistentFunction");

      expect(response.status).toBe(404);
      expect(response.body.error).toBe("Function not found");
    });

    test("should require authentication for function operations", async () => {
      const response = await request(testHelper.app).get("/v1/functions");

      expect(response.status).toBe(401);
    });
  });

  describe("Function Execution - getPage", () => {
    test("should successfully fetch a webpage", async () => {
      // Mock HTTP request
      const mockHtml =
        "<html><head><title>Test Page</title></head><body><h1>Hello World</h1></body></html>";
      const testUrl = "https://example.com/test";

      nock("https://example.com").get("/test").reply(200, mockHtml, {
        "content-type": "text/html",
      });

      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/functions/getPage:call")
        .send({
          data: {
            url: testUrl,
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.result).toBeDefined();
      expect(response.body.result.success).toBe(true);
      expect(response.body.result.data).toBe(mockHtml);
      expect(response.body.result.status).toBe(200);
      expect(response.body.functionName).toBe("getPage");
      expect(response.body.executedAt).toBeDefined();
    });

    test("should handle HTTP errors gracefully", async () => {
      const testUrl = "https://example.com/notfound";

      nock("https://example.com").get("/notfound").reply(404, "Not Found");

      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/functions/getPage:call")
        .send({
          data: {
            url: testUrl,
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.result).toBeDefined();
      expect(response.body.result.success).toBe(false);
      expect(response.body.result.error).toContain("HTTP Error: 404");
      expect(response.body.result.status).toBe(404);
    });

    test("should handle network errors gracefully", async () => {
      const testUrl = "https://nonexistent-domain-12345.com/test";

      nock("https://nonexistent-domain-12345.com")
        .get("/test")
        .replyWithError("ENOTFOUND");

      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/functions/getPage:call")
        .send({
          data: {
            url: testUrl,
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.result).toBeDefined();
      expect(response.body.result.success).toBe(false);
      expect(response.body.result.error).toContain("Network Error");
    });

    test("should validate required parameters", async () => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/functions/getPage:call")
        .send({
          data: {
            // Missing url parameter
          },
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe("Function execution failed");
      expect(response.body.details).toContain('Parameter "url" is required');
    });

    test("should handle malformed URL parameters", async () => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/functions/getPage:call")
        .send({
          data: {
            url: 123, // Invalid type - should be string
          },
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe("Function execution failed");
      expect(response.body.details).toContain(
        'Parameter "url" is required and must be a string'
      );
    });

    test("should handle timeouts (mocked)", async () => {
      const testUrl = "https://slow-example.com/test";

      nock("https://slow-example.com")
        .get("/test")
        .delay(15000) // 15 second delay - longer than axios timeout
        .reply(200, "Eventually loads");

      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/functions/getPage:call")
        .send({
          data: {
            url: testUrl,
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.result).toBeDefined();
      expect(response.body.result.success).toBe(false);
      // Axios timeout shows up as network error or request error
      expect(response.body.result.error).toMatch(
        /(timeout|Network Error|Request Error)/i
      );
    });
  });

  describe("Function Execution - sendSms", () => {
    test("should successfully call sendSms function (mocked)", async () => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/functions/sendSms:call")
        .send({
          data: {
            to: "+15551234567",
            message: "Hello from BaseBase!",
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.result).toBeDefined();
      expect(response.body.result.success).toBe(true);
      expect(response.body.result.message).toContain("SMS sent successfully");
      expect(response.body.result.to).toBe("+15551234567");
      expect(response.body.result.messageLength).toBe(20);
      expect(response.body.functionName).toBe("sendSms");
    });

    test("should validate SMS parameters", async () => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/functions/sendSms:call")
        .send({
          data: {
            // Missing required parameters
          },
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe("Function execution failed");
      expect(response.body.details).toContain('Parameter "to" is required');
    });
  });

  describe("Function Security and Access Control", () => {
    test("should require authentication", async () => {
      const response = await request(testHelper.app)
        .post("/v1/projects/test-project/functions/getPage:call")
        .send({
          data: {
            url: "https://example.com",
          },
        });

      expect(response.status).toBe(401);
    });

    test("should only allow calling functions in user's own project", async () => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/different-project/functions/getPage:call")
        .send({
          data: {
            url: "https://example.com",
          },
        });

      expect(response.status).toBe(404); // Project resolution should fail
    });

    test("should return 404 for non-existent functions", async () => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/functions/nonExistentFunction:call")
        .send({
          data: {},
        });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe("Function not found");
    });

    test("should handle malformed request body", async () => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/functions/getPage:call")
        .send("invalid json");

      // Express will return 500 for JSON parse errors in middleware
      expect(response.status).toBe(500);
    });

    test("should provide helpful error messages", async () => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/functions/getPage:call")
        .send({
          data: {
            url: "", // Empty URL
          },
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe("Function execution failed");
      expect(response.body.suggestion).toContain(
        "Check the function parameters"
      );
    });
  });

  describe("Real HTTP Requests", () => {
    test("should fetch real webpage content (integration test)", async () => {
      // This is an actual HTTP request - use a reliable test endpoint
      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/functions/getPage:call")
        .send({
          data: {
            url: "https://httpbin.org/json",
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.result).toBeDefined();
      expect(response.body.result.success).toBe(true);
      expect(response.body.result.status).toBe(200);

      // The data is already parsed as an object by axios
      const fetchedData = response.body.result.data;
      expect(fetchedData).toHaveProperty("slideshow");
    }, 10000); // Longer timeout for real HTTP request
  });
});
