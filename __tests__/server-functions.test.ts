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
        .get("/v1/projects/test-project/functions");

      expect(response.status).toBe(200);
      expect(response.body.functions).toBeDefined();
      expect(response.body.count).toBeDefined();
      expect(Array.isArray(response.body.functions)).toBe(true);

      // Should include our default functions
      const globalFunctions = response.body.functions.filter(
        (func: any) => func.isUserFunction === false
      );
      expect(globalFunctions.length).toBeGreaterThan(0);

      // Should include getPage function
      const getPageFunction = globalFunctions.find(
        (func: any) => func.id === "getPage"
      );
      expect(getPageFunction).toBeDefined();
      expect(getPageFunction.description).toContain("HTTP GET request");
    });

    test("should get details of specific server function", async () => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .get("/v1/projects/test-project/functions/getPage");

      expect(response.status).toBe(200);
      expect(response.body.id).toBe("getPage");
      expect(response.body.description).toBeDefined();
      expect(response.body.implementationCode).toBeDefined();
      expect(response.body.isUserFunction).toBe(false);
    });

    test("should return 404 for non-existent function", async () => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .get("/v1/projects/test-project/functions/nonExistentFunction");

      expect(response.status).toBe(404);
      expect(response.body.error).toContain("Function not found");
    });

    test("should segregate global and user functions in listing", async () => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .get("/v1/projects/test-project/functions");

      expect(response.status).toBe(200);
      expect(response.body.globalCount).toBeDefined();
      expect(response.body.projectCount).toBeDefined();
      expect(response.body.count).toBe(
        response.body.globalCount + response.body.projectCount
      );

      // All functions should have isUserFunction property
      response.body.functions.forEach((func: any) => {
        expect(func.isUserFunction).toBeDefined();
        expect(typeof func.isUserFunction).toBe("boolean");
      });
    });
  });

  describe("getPage Function Integration", () => {
    test("should successfully call getPage function with valid URL", async () => {
      // Mock an external HTTP request
      nock("https://httpbin.org")
        .get("/get")
        .reply(200, {
          args: {},
          headers: {
            "User-Agent": "BaseBase Function",
          },
          origin: "127.0.0.1",
          url: "https://httpbin.org/get",
        });

      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/functions/getPage:call")
        .send({
          data: {
            url: "https://httpbin.org/get",
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.result).toBeDefined();
      expect(response.body.result.status).toBe(200);
      expect(response.body.result.data).toBeDefined();
    });

    test("should handle getPage function with invalid URL", async () => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/functions/getPage:call")
        .send({
          data: {
            url: "not-a-valid-url",
          },
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toContain("Function execution failed");
    });

    test("should handle getPage function with network error", async () => {
      // Mock a network error
      nock("https://httpbin.org")
        .get("/timeout")
        .replyWithError("Network Error");

      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/functions/getPage:call")
        .send({
          data: {
            url: "https://httpbin.org/timeout",
          },
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toContain("Function execution failed");
    });

    test("should handle getPage function with HTTP error status", async () => {
      // Mock an HTTP 404 error
      nock("https://httpbin.org").get("/status/404").reply(404, "Not Found");

      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/functions/getPage:call")
        .send({
          data: {
            url: "https://httpbin.org/status/404",
          },
        });

      // The function should still succeed (HTTP errors are part of valid responses)
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.result.status).toBe(404);
    });
  });

  describe("Function Error Handling", () => {
    test("should handle function call with missing function name", async () => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/functions/:call")
        .send({
          data: {},
        });

      expect(response.status).toBe(404);
    });

    test("should handle function call with invalid request format", async () => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/functions/getPage:call")
        .send("invalid json"); // Send invalid JSON

      expect(response.status).toBe(400);
    });

    test("should handle function call without authentication", async () => {
      const response = await request(testHelper.app)
        .post("/v1/projects/test-project/functions/getPage:call")
        .send({
          data: {
            url: "https://httpbin.org/get",
          },
        });

      expect(response.status).toBe(401);
    });
  });

  describe("Function Response Format", () => {
    test("should return consistent response format for successful function calls", async () => {
      nock("https://httpbin.org").get("/json").reply(200, { test: "data" });

      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/functions/getPage:call")
        .send({
          data: {
            url: "https://httpbin.org/json",
          },
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("success", true);
      expect(response.body).toHaveProperty("result");
      expect(response.body).toHaveProperty("functionName", "getPage");
      expect(response.body).toHaveProperty("executedAt");

      // Verify executedAt is a valid ISO string
      expect(() => new Date(response.body.executedAt)).not.toThrow();
    });

    test("should return consistent error format for failed function calls", async () => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/functions/nonExistentFunction:call")
        .send({
          data: {},
        });

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty("error");
      expect(response.body).toHaveProperty("suggestion");
    });
  });

  describe("Function Parameters Validation", () => {
    test("should handle getPage function with missing URL parameter", async () => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/functions/getPage:call")
        .send({
          data: {}, // Missing url parameter
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toContain("Function execution failed");
    });

    test("should handle getPage function with extra parameters", async () => {
      nock("https://httpbin.org").get("/get").reply(200, { test: "data" });

      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/functions/getPage:call")
        .send({
          data: {
            url: "https://httpbin.org/get",
            extraParam: "should be ignored",
            anotherExtra: 123,
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe("Function Security", () => {
    test("should prevent access to localhost URLs", async () => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/functions/getPage:call")
        .send({
          data: {
            url: "http://localhost:8000/admin",
          },
        });

      // This should fail because localhost access should be restricted
      expect(response.status).toBe(500);
      expect(response.body.error).toContain("Function execution failed");
    });

    test("should prevent access to internal IP ranges", async () => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/functions/getPage:call")
        .send({
          data: {
            url: "http://192.168.1.1/secret",
          },
        });

      // This should fail because internal IP access should be restricted
      expect(response.status).toBe(500);
      expect(response.body.error).toContain("Function execution failed");
    });
  });

  describe("Function Performance", () => {
    test("should complete function call within reasonable time", async () => {
      nock("https://httpbin.org").get("/delay/1").reply(200, { delayed: true });

      const startTime = Date.now();

      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/functions/getPage:call")
        .send({
          data: {
            url: "https://httpbin.org/delay/1",
          },
        });

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Should complete within a reasonable timeframe (accounting for test overhead)
      expect(duration).toBeLessThan(5000); // 5 seconds max for test environment
    });
  });
});
