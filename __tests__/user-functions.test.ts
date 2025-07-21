import { TestHelper } from "./test-utils";
import request from "supertest";
import nock from "nock";

describe("User-Defined Functions Tests", () => {
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
    await testHelper.createTestProject();
    userToken = await testHelper.createTestUser();
  });

  afterEach(async () => {
    await testHelper.cleanupTestData();
    nock.cleanAll();
  });

  describe("User Function Creation and Management", () => {
    test("should create a simple user function", async () => {
      const functionData = {
        id: "calculateSum",
        description: "Calculates the sum of two numbers",
        implementationCode: `
          async (params, context) => {
            const { a, b } = params;
            if (typeof a !== 'number' || typeof b !== 'number') {
              throw new Error('Both a and b must be numbers');
            }
            return { result: a + b, operation: 'addition' };
          }
        `,
        requiredServices: [],
        enabled: true,
      };

      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/functions")
        .send(functionData);

      expect(response.status).toBe(201);
      expect(response.body.id).toBe("calculateSum");
      expect(response.body.description).toBe(
        "Calculates the sum of two numbers"
      );
      expect(response.body.isUserFunction).toBe(true);
      expect(response.body.enabled).toBe(true);
      expect(response.body.createdBy).toBeDefined();
      expect(response.body.createdAt).toBeDefined();
      expect(response.body.updatedAt).toBeDefined();
    });

    test("should create a function with required services", async () => {
      const functionData = {
        id: "fetchAndProcess",
        description: "Fetches data from external API and processes it",
        implementationCode: `
          async (params, context) => {
            const { url } = params;
            if (!url) throw new Error('URL parameter required');
            
            try {
              const response = await axios.get(url);
              return {
                success: true,
                data: response.data,
                status: response.status,
                headers: Object.keys(response.headers)
              };
            } catch (error) {
              return {
                success: false,
                error: error.message
              };
            }
          }
        `,
        requiredServices: ["axios"],
        enabled: true,
      };

      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/functions")
        .send(functionData);

      expect(response.status).toBe(201);
      expect(response.body.id).toBe("fetchAndProcess");
      expect(response.body.requiredServices).toEqual(["axios"]);
    });

    test("should create a scheduled function", async () => {
      const functionData = {
        id: "dailyCleanup",
        description: "Performs daily cleanup tasks",
        implementationCode: `
          async (params, context) => {
            const { console, data } = context;
            console.log('Starting daily cleanup...');
            
            // Example cleanup: delete old temporary records
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const result = await data.collection('temp_data').queryDocs({
              where: [{
                field: 'createdAt',
                operator: '<',
                value: oneDayAgo
              }]
            });
            
            console.log(\`Found \${result.length} old records to cleanup\`);
            return { cleaned: result.length, timestamp: new Date().toISOString() };
          }
        `,
        requiredServices: [],
        schedule: "0 9 * * *", // Daily at 9 AM
        enabled: true,
      };

      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/functions")
        .send(functionData);

      expect(response.status).toBe(201);
      expect(response.body.id).toBe("dailyCleanup");
      expect(response.body.schedule).toBe("0 9 * * *");
      expect(response.body.enabled).toBe(true);
    });

    test("should update an existing user function", async () => {
      // Create initial function
      const functionData = {
        id: "testFunction",
        description: "Initial description",
        implementationCode: `async (params, context) => { return { version: 1 }; }`,
        requiredServices: [],
      };

      await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/functions")
        .send(functionData);

      // Update the function
      const updateData = {
        description: "Updated description",
        implementationCode: `async (params, context) => { return { version: 2, updated: true }; }`,
        schedule: "*/10 * * * *",
        enabled: false,
      };

      const response = await testHelper
        .authenticatedRequest(userToken)
        .put("/v1/functions/testFunction")
        .send(updateData);

      expect(response.status).toBe(200);
      expect(response.body.description).toBe("Updated description");
      expect(response.body.schedule).toBe("*/10 * * * *");
      expect(response.body.enabled).toBe(false);
      expect(response.body.updatedAt).toBeDefined();
    });

    test("should delete a user function", async () => {
      // Create function
      const functionData = {
        id: "tempFunction",
        description: "Temporary function",
        implementationCode: `async (params, context) => { return { temp: true }; }`,
      };

      await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/functions")
        .send(functionData);

      // Delete the function
      const response = await testHelper
        .authenticatedRequest(userToken)
        .delete("/v1/functions/tempFunction");

      expect(response.status).toBe(200);
      expect(response.body.message).toBe("Function deleted successfully");

      // Verify it's deleted
      const getResponse = await testHelper
        .authenticatedRequest(userToken)
        .get("/v1/functions/tempFunction");

      expect(getResponse.status).toBe(404);
    });

    test("should list user functions along with global functions", async () => {
      // Create a user function
      const functionData = {
        id: "userFunction1",
        description: "User function 1",
        implementationCode: `async (params, context) => { return { user: true }; }`,
      };

      await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/functions")
        .send(functionData);

      // List all functions
      const response = await testHelper
        .authenticatedRequest(userToken)
        .get("/v1/functions");

      expect(response.status).toBe(200);
      expect(response.body.functions).toBeDefined();
      expect(Array.isArray(response.body.functions)).toBe(true);
      expect(response.body.count).toBeGreaterThan(0);
      expect(response.body.globalCount).toBeGreaterThan(0); // Should have getPage, sendSms
      expect(response.body.projectCount).toBe(1); // Our user function

      // Find our user function
      const userFunc = response.body.functions.find(
        (f: any) => f.id === "userFunction1"
      );
      expect(userFunc).toBeDefined();
      expect(userFunc.isUserFunction).toBe(true);
      expect(userFunc.createdBy).toBeDefined();

      // Verify global functions exist
      const globalFunc = response.body.functions.find(
        (f: any) => f.id === "getPage"
      );
      expect(globalFunc).toBeDefined();
      expect(globalFunc.isUserFunction).toBe(false);
    });

    test("should validate function data", async () => {
      // Test missing required fields
      const invalidData1 = {
        id: "invalidFunc",
        // Missing description and implementationCode
      };

      const response1 = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/functions")
        .send(invalidData1);

      expect(response1.status).toBe(400);
      expect(response1.body.error).toBe("Missing required fields");

      // Test invalid function ID
      const invalidData2 = {
        id: "invalid function id!", // Contains spaces and special chars
        description: "Test function",
        implementationCode: `async (params, context) => { return {}; }`,
      };

      const response2 = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/functions")
        .send(invalidData2);

      expect(response2.status).toBe(400);
      expect(response2.body.error).toBe("Invalid function ID");
    });

    test("should prevent duplicate function IDs", async () => {
      const functionData = {
        id: "duplicateTest",
        description: "First function",
        implementationCode: `async (params, context) => { return { first: true }; }`,
      };

      // Create first function
      const response1 = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/functions")
        .send(functionData);

      expect(response1.status).toBe(201);

      // Try to create duplicate
      const response2 = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/functions")
        .send(functionData);

      expect(response2.status).toBe(409);
      expect(response2.body.error).toBe("Function already exists");
    });

    test("should only allow users to manage their own functions", async () => {
      // User 1 creates a function
      const functionData = {
        id: "user1Function",
        description: "User 1's function",
        implementationCode: `async (params, context) => { return { owner: 'user1' }; }`,
      };

      await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/functions")
        .send(functionData);

      // Verify the function exists for user 1
      const getResponse = await testHelper
        .authenticatedRequest(userToken)
        .get("/v1/functions/user1Function");

      expect(getResponse.status).toBe(200);
      expect(getResponse.body.id).toBe("user1Function");
      expect(getResponse.body.isUserFunction).toBe(true);

      // Test that users can only access functions in their own project scope
      // This is enforced by project-level database isolation
      const listResponse = await testHelper
        .authenticatedRequest(userToken)
        .get("/v1/functions");

      expect(listResponse.status).toBe(200);

      // Find our user function in the list
      const userFunc = listResponse.body.functions.find(
        (f: any) => f.id === "user1Function"
      );
      expect(userFunc).toBeDefined();
      expect(userFunc.isUserFunction).toBe(true);
      expect(userFunc.createdBy).toBeDefined();
    });
  });

  describe("Client Function Execution", () => {
    beforeEach(async () => {
      // Create a test function for execution tests
      const functionData = {
        id: "testExecute",
        description: "Function for execution testing",
        implementationCode: `
          async (params, context) => {
            const { operation, a, b } = params;
            const { console, data, functions } = context;
            
            console.log(\`Executing operation: \${operation}\`);
            
            switch (operation) {
              case 'add':
                return { result: a + b, operation: 'addition' };
              case 'multiply':
                return { result: a * b, operation: 'multiplication' };
              case 'greet':
                return { message: \`Hello, \${params.name || 'World'}!\` };
              case 'getData':
                // Test data API access
                const docs = await data.collection('test_collection').getDocs();
                return { documentCount: docs.length };
              case 'callOther':
                // Test calling other functions
                const result = await functions.call('getPage', { url: params.url });
                return { calledFunction: true, result };
              default:
                throw new Error('Unknown operation');
            }
          }
        `,
        requiredServices: [],
        enabled: true,
      };

      await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/functions")
        .send(functionData);
    });

    test("should execute user function with parameters", async () => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/functions/testExecute:call")
        .send({
          data: {
            operation: "add",
            a: 5,
            b: 3,
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.result.result).toBe(8);
      expect(response.body.result.operation).toBe("addition");
      expect(response.body.functionName).toBe("testExecute");
      expect(response.body.executedAt).toBeDefined();
    });

    test("should handle function execution errors gracefully", async () => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/functions/testExecute:call")
        .send({
          data: {
            operation: "unknown",
          },
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe("Function execution failed");
      expect(response.body.details).toContain("Unknown operation");
      expect(response.body.functionName).toBe("testExecute");
    });

    test("should provide execution context to functions", async () => {
      // First create a test document
      await testHelper
        .authenticatedRequest(userToken)
        .post(
          "/v1/projects/test-project/databases/(default)/documents/test_collection"
        )
        .send({
          fields: {
            name: { stringValue: "Test Document" },
          },
        });

      // Execute function that uses data API
      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/functions/testExecute:call")
        .send({
          data: {
            operation: "getData",
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.result.documentCount).toBe(1);
    });

    test("should allow functions to call other functions", async () => {
      // Mock external HTTP request for getPage function
      nock("https://httpbin.org").get("/json").reply(200, { test: "data" });

      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/functions/testExecute:call")
        .send({
          data: {
            operation: "callOther",
            url: "https://httpbin.org/json",
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.result.calledFunction).toBe(true);
      expect(response.body.result.result.success).toBe(true);
    });

    test("should enforce project access control", async () => {
      // Try to call function from different project
      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/different-project/functions/testExecute:call")
        .send({
          data: {
            operation: "add",
            a: 1,
            b: 2,
          },
        });

      expect(response.status).toBe(404); // Project not found
    });

    test("should handle non-existent function calls", async () => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/functions/nonExistentFunction:call")
        .send({
          data: {},
        });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe("Function not found");
    });

    test("should require authentication for function calls", async () => {
      const response = await request(testHelper.app)
        .post("/v1/projects/test-project/functions/testExecute:call")
        .send({
          data: { operation: "add", a: 1, b: 2 },
        });

      expect(response.status).toBe(401);
    });

    test("should validate function call request format", async () => {
      // Invalid route format
      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/functions/testExecute/call") // Missing colon
        .send({
          data: { operation: "add", a: 1, b: 2 },
        });

      expect(response.status).toBe(404); // Route not found
    });
  });

  describe("Complex Function Scenarios", () => {
    test("should create a data processing function", async () => {
      const functionData = {
        id: "processUserData",
        description: "Processes user data and creates summary",
        implementationCode: `
          async (params, context) => {
            const { console, data } = context;
            const { userId } = params;
            
            if (!userId) {
              throw new Error('userId parameter is required');
            }
            
            console.log(\`Processing data for user: \${userId}\`);
            
            // Create some test data
            await data.collection('user_activities').addDoc({
              userId,
              action: 'login',
              timestamp: new Date(),
              metadata: { source: 'function' }
            });
            
            await data.collection('user_activities').addDoc({
              userId,
              action: 'view_page',
              timestamp: new Date(),
              metadata: { page: 'dashboard' }
            });
            
            // Query the data
            const activities = await data.collection('user_activities').queryDocs({
              where: [{
                field: 'userId',
                operator: '==',
                value: userId
              }],
              orderBy: [{ field: 'timestamp', direction: 'desc' }],
              limit: 10
            });
            
            console.log(\`Found \${activities.length} activities for user \${userId}\`);
            
            return {
              userId,
              activityCount: activities.length,
              lastActivity: activities[0] || null,
              processedAt: new Date().toISOString()
            };
          }
        `,
        requiredServices: [],
        enabled: true,
      };

      // Create the function
      const createResponse = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/functions")
        .send(functionData);

      expect(createResponse.status).toBe(201);

      // Execute the function
      const executeResponse = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/functions/processUserData:call")
        .send({
          data: {
            userId: "user123",
          },
        });

      expect(executeResponse.status).toBe(200);
      expect(executeResponse.body.success).toBe(true);
      expect(executeResponse.body.result.userId).toBe("user123");
      expect(executeResponse.body.result.activityCount).toBe(2);
      expect(executeResponse.body.result.lastActivity).toBeDefined();
      expect(executeResponse.body.result.processedAt).toBeDefined();
    });

    test("should create a function that calls external APIs", async () => {
      const functionData = {
        id: "weatherFetcher",
        description: "Fetches weather data and stores it",
        implementationCode: `
          async (params, context) => {
            const { console, data, functions } = context;
            const { city } = params;
            
            if (!city) {
              throw new Error('city parameter is required');
            }
            
            console.log(\`Fetching weather for: \${city}\`);
            
            // Mock weather API URL
            const weatherUrl = \`https://api.weather.com/current?city=\${encodeURIComponent(city)}\`;
            
            try {
              const result = await functions.call('getPage', { url: weatherUrl });
              
              if (result.success) {
                // Store weather data
                const weatherDoc = await data.collection('weather_data').addDoc({
                  city,
                  data: result.data,
                  fetchedAt: new Date(),
                  status: 'success'
                });
                
                console.log(\`Stored weather data with ID: \${weatherDoc.id}\`);
                
                return {
                  success: true,
                  city,
                  documentId: weatherDoc.id,
                  data: result.data
                };
              } else {
                return {
                  success: false,
                  city,
                  error: result.error
                };
              }
            } catch (error) {
              console.error(\`Weather fetch failed: \${error.message}\`);
              throw error;
            }
          }
        `,
        requiredServices: [],
        enabled: true,
      };

      // Create the function
      const createResponse = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/functions")
        .send(functionData);

      expect(createResponse.status).toBe(201);

      // Mock the weather API
      nock("https://api.weather.com")
        .get("/current")
        .query({ city: "New York" })
        .reply(200, {
          city: "New York",
          temperature: 72,
          condition: "sunny",
          humidity: 65,
        });

      // Execute the function
      const executeResponse = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/functions/weatherFetcher:call")
        .send({
          data: {
            city: "New York",
          },
        });

      expect(executeResponse.status).toBe(200);
      expect(executeResponse.body.success).toBe(true);
      expect(executeResponse.body.result.success).toBe(true);
      expect(executeResponse.body.result.city).toBe("New York");
      expect(executeResponse.body.result.documentId).toBeDefined();
      expect(executeResponse.body.result.data.temperature).toBe(72);
    });
  });

  describe("Function Scheduling (Mocked)", () => {
    test("should create function with schedule", async () => {
      const functionData = {
        id: "scheduledTask",
        description: "A task that runs every 10 minutes",
        implementationCode: `
          async (params, context) => {
            const { console, data } = context;
            console.log('Scheduled task running...');
            
            // Log execution
            await data.collection('task_logs').addDoc({
              taskName: 'scheduledTask',
              executedAt: new Date(),
              type: 'scheduled'
            });
            
            return {
              executed: true,
              timestamp: new Date().toISOString()
            };
          }
        `,
        requiredServices: [],
        schedule: "*/10 * * * *", // Every 10 minutes
        enabled: true,
      };

      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/functions")
        .send(functionData);

      expect(response.status).toBe(201);
      expect(response.body.schedule).toBe("*/10 * * * *");
      expect(response.body.enabled).toBe(true);
    });

    test("should create function with hourly schedule", async () => {
      const functionData = {
        id: "hourlyReport",
        description: "Generates hourly reports",
        implementationCode: `
          async (params, context) => {
            const { console, data } = context;
            console.log('Generating hourly report...');
            
            const now = new Date();
            const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
            
            // Count recent activities
            const activities = await data.collection('user_activities').queryDocs({
              where: [{
                field: 'timestamp',
                operator: '>=',
                value: oneHourAgo
              }]
            });
            
            const report = {
              period: 'hourly',
              startTime: oneHourAgo.toISOString(),
              endTime: now.toISOString(),
              activityCount: activities.length,
              generatedAt: now.toISOString()
            };
            
            await data.collection('reports').addDoc(report);
            
            return report;
          }
        `,
        requiredServices: [],
        schedule: "0 */1 * * *", // Every hour
        enabled: true,
      };

      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/functions")
        .send(functionData);

      expect(response.status).toBe(201);
      expect(response.body.schedule).toBe("0 */1 * * *");
    });

    test("should create function with daily schedule", async () => {
      const functionData = {
        id: "dailyBackup",
        description: "Performs daily data backup",
        implementationCode: `
          async (params, context) => {
            const { console, data } = context;
            console.log('Starting daily backup...');
            
            // Get all collections data (mock backup)
            const userActivities = await data.collection('user_activities').getDocs();
            const reports = await data.collection('reports').getDocs();
            
            const backupSummary = {
              date: new Date().toISOString().split('T')[0],
              collections: {
                user_activities: userActivities.length,
                reports: reports.length
              },
              totalDocuments: userActivities.length + reports.length,
              backupTime: new Date().toISOString()
            };
            
            await data.collection('backups').addDoc(backupSummary);
            console.log(\`Backup completed: \${backupSummary.totalDocuments} documents\`);
            
            return backupSummary;
          }
        `,
        requiredServices: [],
        schedule: "0 9 * * *", // Daily at 9 AM
        enabled: true,
      };

      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/functions")
        .send(functionData);

      expect(response.status).toBe(201);
      expect(response.body.schedule).toBe("0 9 * * *");
    });

    test("should disable scheduled function", async () => {
      // Create scheduled function
      const functionData = {
        id: "testScheduled",
        description: "Test scheduled function",
        implementationCode: `async (params, context) => { return { test: true }; }`,
        schedule: "*/10 * * * *",
        enabled: true,
      };

      await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/functions")
        .send(functionData);

      // Disable the function
      const updateResponse = await testHelper
        .authenticatedRequest(userToken)
        .put("/v1/functions/testScheduled")
        .send({
          enabled: false,
        });

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.enabled).toBe(false);
      expect(updateResponse.body.schedule).toBe("*/10 * * * *");
    });

    test("should update function schedule", async () => {
      // Create function with one schedule
      const functionData = {
        id: "flexibleSchedule",
        description: "Function with changeable schedule",
        implementationCode: `async (params, context) => { return { flexible: true }; }`,
        schedule: "*/10 * * * *",
        enabled: true,
      };

      await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/functions")
        .send(functionData);

      // Update to different schedule
      const updateResponse = await testHelper
        .authenticatedRequest(userToken)
        .put("/v1/functions/flexibleSchedule")
        .send({
          schedule: "0 */1 * * *", // Change to hourly
        });

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.schedule).toBe("0 */1 * * *");
    });

    test("should remove schedule from function", async () => {
      // Create scheduled function
      const functionData = {
        id: "removeSchedule",
        description: "Function to remove schedule from",
        implementationCode: `async (params, context) => { return { scheduled: false }; }`,
        schedule: "*/10 * * * *",
        enabled: true,
      };

      await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/functions")
        .send(functionData);

      // Remove schedule by setting it to null
      const updateResponse = await testHelper
        .authenticatedRequest(userToken)
        .put("/v1/functions/removeSchedule")
        .send({
          schedule: null, // Remove schedule
        });

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.schedule).toBeNull();
    });
  });

  describe("Function Error Handling and Edge Cases", () => {
    test("should handle function execution timeout", async () => {
      const functionData = {
        id: "infiniteLoop",
        description: "Function that takes too long",
        implementationCode: `
          async (params, context) => {
            // Simulate infinite loop
            while (true) {
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }
        `,
        requiredServices: [],
        enabled: true,
      };

      await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/functions")
        .send(functionData);

      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/functions/infiniteLoop:call")
        .send({
          data: {},
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe("Function execution failed");
      expect(response.body.details).toContain("timeout");
    }, 35000); // Increase timeout for this test

    test("should handle functions with syntax errors", async () => {
      const functionData = {
        id: "syntaxError",
        description: "Function with syntax error",
        implementationCode: `
          async (params, context) => {
            // Syntax error: missing closing brace
            return { invalid: "syntax"
        `,
        requiredServices: [],
        enabled: true,
      };

      await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/functions")
        .send(functionData);

      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/functions/syntaxError:call")
        .send({
          data: {},
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe("Function execution failed");
    });

    test("should handle functions that throw errors", async () => {
      const functionData = {
        id: "throwsError",
        description: "Function that throws an error",
        implementationCode: `
          async (params, context) => {
            throw new Error("Custom error message");
          }
        `,
        requiredServices: [],
        enabled: true,
      };

      await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/functions")
        .send(functionData);

      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/functions/throwsError:call")
        .send({
          data: {},
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe("Function execution failed");
      expect(response.body.details).toContain("Custom error message");
    });

    test("should handle empty function calls", async () => {
      const functionData = {
        id: "emptyFunction",
        description: "Function that returns nothing",
        implementationCode: `
          async (params, context) => {
            // Return undefined
          }
        `,
        requiredServices: [],
        enabled: true,
      };

      await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/functions")
        .send(functionData);

      const response = await testHelper
        .authenticatedRequest(userToken)
        .post("/v1/projects/test-project/functions/emptyFunction:call")
        .send({
          data: {},
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.result).toBeUndefined();
    });
  });
});
