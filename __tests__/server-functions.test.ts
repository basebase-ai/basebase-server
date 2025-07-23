import { TestHelper } from "./test-utils";
import request from "supertest";
import nock from "nock";

describe("Server Tasks Tests", () => {
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

  describe("Task Management", () => {
    test("should list available server tasks", async () => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .get("/v1/projects/test-project/tasks");

      expect(response.status).toBe(200);
      expect(response.body.tasks).toBeDefined();
      expect(response.body.count).toBeDefined();
      expect(Array.isArray(response.body.tasks)).toBe(true);

      // Should include our default tasks
      const globalTasks = response.body.tasks.filter(
        (task: any) => task.isUserTask === false
      );
      expect(globalTasks.length).toBeGreaterThan(0);

      // Should include getPage task
      const getPageTask = globalTasks.find(
        (task: any) => task.id === "getPage"
      );
      expect(getPageTask).toBeDefined();
      expect(getPageTask.description).toContain("Fetch web page content");
    });

    test("should get details of specific server task", async () => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .get("/v1/projects/test-project/tasks/getPage");

      expect(response.status).toBe(200);
      expect(response.body.id).toBe("getPage");
      expect(response.body.description).toBeDefined();
      expect(response.body.implementationCode).toBeDefined();
      expect(response.body.isUserTask).toBe(false);
    });

    test("should return 404 for non-existent task", async () => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .get("/v1/projects/test-project/tasks/nonExistentTask");

      expect(response.status).toBe(404);
      expect(response.body.error).toContain("Task not found");
    });

    test("should segregate global and user tasks in listing", async () => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .get("/v1/projects/test-project/tasks");

      expect(response.status).toBe(200);
      expect(response.body.globalCount).toBeDefined();
      expect(response.body.projectCount).toBeDefined();
      expect(response.body.count).toBe(
        response.body.globalCount + response.body.projectCount
      );

      // All tasks should have isUserTask property
      response.body.tasks.forEach((task: any) => {
        expect(task.isUserTask).toBeDefined();
        expect(typeof task.isUserTask).toBe("boolean");
      });
    });
  });

  describe("getPage Task Integration", () => {
    test("should successfully call getPage task with valid URL", async () => {
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
        .post("/v1/projects/test-project/tasks/getPage:do")
        .send({
          data: {
            url: "https://httpbin.org/get",
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.result).toBeDefined();
      expect(response.body.result.success).toBe(true);
      expect(response.body.result.content).toBeDefined();
    });

    test("should handle getPage task with invalid URL", async () => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/tasks/getPage:do")
        .send({
          data: {
            url: "not-a-valid-url",
          },
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toContain("Task execution failed");
    });

    test("should handle getPage task with network error", async () => {
      // Mock a network error
      nock("https://httpbin.org")
        .get("/timeout")
        .replyWithError("Network Error");

      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/tasks/getPage:do")
        .send({
          data: {
            url: "https://httpbin.org/timeout",
          },
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toContain("Task execution failed");
    });

    test("should handle getPage task with HTTP error status", async () => {
      // Mock an HTTP 404 error
      nock("https://httpbin.org").get("/status/404").reply(404, "Not Found");

      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/tasks/getPage:do")
        .send({
          data: {
            url: "https://httpbin.org/status/404",
          },
        });

      // The task should still succeed (HTTP errors are part of valid responses)
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.result.success).toBe(true);
    });
  });

  describe("Task Error Handling", () => {
    test("should handle task call with missing task name", async () => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/tasks/:do")
        .send({
          data: {},
        });

      expect(response.status).toBe(404);
    });

    test("should handle task call with invalid request format", async () => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/tasks/getPage:do")
        .send("invalid json"); // Send invalid JSON

      expect(response.status).toBe(500);
    });

    test("should handle task call without authentication", async () => {
      const response = await request(testHelper.app)
        .post("/v1/projects/test-project/tasks/getPage:do")
        .send({
          data: {
            url: "https://httpbin.org/get",
          },
        });

      expect(response.status).toBe(401);
    });
  });

  describe("Task Response Format", () => {
    test("should return consistent response format for successful task calls", async () => {
      nock("https://httpbin.org").get("/json").reply(200, { test: "data" });

      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/tasks/getPage:do")
        .send({
          data: {
            url: "https://httpbin.org/json",
          },
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("success", true);
      expect(response.body).toHaveProperty("result");
      expect(response.body).toHaveProperty("taskName", "getPage");
      expect(response.body).toHaveProperty("executedAt");

      // Verify executedAt is a valid ISO string
      expect(() => new Date(response.body.executedAt)).not.toThrow();
    });

    test("should return consistent error format for failed task calls", async () => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/tasks/nonExistentTask:do")
        .send({
          data: {},
        });

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty("error");
      expect(response.body).toHaveProperty("suggestion");
    });
  });

  describe("Task Parameters Validation", () => {
    test("should handle getPage function with missing URL parameter", async () => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/tasks/getPage:do")
        .send({
          data: {}, // Missing url parameter
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toContain("Task execution failed");
    });

    test("should handle getPage function with extra parameters", async () => {
      nock("https://httpbin.org").get("/get").reply(200, { test: "data" });

      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/tasks/getPage:do")
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

  describe("Task Security", () => {
    test("should prevent access to internal IP ranges", async () => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/tasks/getPage:do")
        .send({
          data: {
            url: "http://192.168.1.1/secret",
          },
        });

      // This should fail because internal IP access should be restricted
      expect(response.status).toBe(500);
      expect(response.body.error).toContain("Task execution failed");
    });
  });

  describe("Task Performance", () => {
    test("should complete task call within reasonable time", async () => {
      nock("https://httpbin.org").get("/delay/1").reply(200, { delayed: true });

      const startTime = Date.now();

      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/tasks/getPage:do")
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
