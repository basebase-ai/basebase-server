import { TestHelper } from "./test-utils";
import request from "supertest";
import jwt from "jsonwebtoken";

describe("Authentication and Project Flow", () => {
  let testHelper: TestHelper;
  const testPhoneNumber = "+15551234567";
  const testUsername = "TestUser";
  const JWT_SECRET = process.env.JWT_SECRET || "test-secret-key";

  beforeAll(async () => {
    testHelper = new TestHelper();
    await testHelper.setup();
  }, 30000);

  afterAll(async () => {
    await testHelper.teardown();
  }, 30000);

  afterEach(async () => {
    await testHelper.cleanupTestData();
  });

  describe("Complete Authentication and Project Flow", () => {
    test("should complete full workflow: create project, authenticate, access documents", async () => {
      // Step 1: Create initial project and user to get authentication working
      console.log("Step 1: Setting up initial project and user...");

      await testHelper.createTestProject();
      const initialToken = await testHelper.createTestUser();

      // Verify the initial token works
      expect(initialToken).toBeDefined();
      const decodedToken = jwt.verify(initialToken, JWT_SECRET) as any;
      expect(decodedToken.userId).toBeDefined();
      expect(decodedToken.projectName).toBeDefined();

      // Step 2: Create a new project via API
      console.log("Step 2: Creating new project via API...");

      const newProjectData = {
        name: "MyNewProject",
        description: "A project created via API",
      };

      const createProjectResponse = await testHelper
        .authenticatedRequest(initialToken)
        .post("/v1/projects")
        .send(newProjectData);

      console.log("Create project response:", {
        status: createProjectResponse.status,
        body: createProjectResponse.body,
      });

      expect(createProjectResponse.status).toBe(201);
      expect(createProjectResponse.body.project).toBeDefined();
      expect(createProjectResponse.body.project.fields.name.stringValue).toBe(
        "MyNewProject"
      );
      expect(createProjectResponse.body.project.name).toBeDefined();
      expect(createProjectResponse.body.apiKey).toBeDefined();

      // Extract project ID from Firebase-style name (e.g., "projects/mynewproject")
      const newProjectId =
        createProjectResponse.body.project.name.split("/")[1];
      const newProjectApiKey = createProjectResponse.body.apiKey;

      // Step 3: Authenticate with the new project
      console.log("Step 3: Authenticating with new project...");

      // Request verification code
      const requestCodeResponse = await request(testHelper.app)
        .post("/v1/requestCode")
        .send({
          username: testUsername,
          phone: testPhoneNumber,
        });

      expect(requestCodeResponse.status).toBe(200);
      expect(requestCodeResponse.body.message).toBeDefined();

      // Get the verification code from database
      const codesCollection = testHelper.mongoClient
        .db("basebase")
        .collection("verification_codes");
      const verificationCodeDoc = await codesCollection.findOne({
        phone: testPhoneNumber,
      });

      expect(verificationCodeDoc).toBeDefined();
      const verificationCode = verificationCodeDoc!.code;

      // Verify code with new project API key
      const verifyCodeResponse = await request(testHelper.app)
        .post("/v1/verifyCode")
        .send({
          phone: testPhoneNumber,
          code: verificationCode,
          projectApiKey: newProjectApiKey,
        });

      console.log("Verify code response:", {
        status: verifyCodeResponse.status,
        body: verifyCodeResponse.body,
      });

      expect(verifyCodeResponse.status).toBe(200);
      expect(verifyCodeResponse.body.token).toBeDefined();
      expect(verifyCodeResponse.body.user).toBeDefined();
      expect(verifyCodeResponse.body.project).toBeDefined();

      const newProjectToken = verifyCodeResponse.body.token;
      const userInfo = verifyCodeResponse.body.user;
      const projectInfo = verifyCodeResponse.body.project;

      // Verify token contains correct project information
      const decodedNewToken = jwt.verify(newProjectToken, JWT_SECRET) as any;
      expect(decodedNewToken.userId).toBeDefined();
      expect(decodedNewToken.projectName).toBe(newProjectId);

      // Step 4: Test project access
      console.log("Step 4: Testing project access...");

      const listProjectsResponse = await testHelper
        .authenticatedRequest(newProjectToken)
        .get("/v1/projects");

      expect(listProjectsResponse.status).toBe(200);
      expect(listProjectsResponse.body.projects).toBeDefined();
      expect(Array.isArray(listProjectsResponse.body.projects)).toBe(true);

      // Should find our new project in the list
      const projects = listProjectsResponse.body.projects;
      const ourProject = projects.find(
        (p: any) => p.name.split("/")[1] === newProjectId
      );
      expect(ourProject).toBeDefined();
      expect(ourProject.fields.name.stringValue).toBe("MyNewProject");

      // Step 5: Test document operations in the new project
      console.log("Step 5: Testing document operations...");

      // Create a document in a collection
      const documentData = {
        fields: {
          title: { stringValue: "Test Document" },
          content: { stringValue: "This is a test document" },
          createdBy: { stringValue: testUsername },
          priority: { integerValue: "1" },
          isActive: { booleanValue: true },
        },
      };

      const createDocResponse = await testHelper
        .authenticatedRequest(newProjectToken)
        .post(
          `/v1/projects/${newProjectId}/databases/(default)/documents/testCollection`
        )
        .send(documentData);

      console.log("Create document response:", {
        status: createDocResponse.status,
        body: createDocResponse.body,
      });

      expect(createDocResponse.status).toBe(201);
      expect(createDocResponse.body.name).toBeDefined();
      expect(createDocResponse.body.fields.title.stringValue).toBe(
        "Test Document"
      );

      const documentId = createDocResponse.body.name;

      // Read the document back
      const readDocResponse = await testHelper
        .authenticatedRequest(newProjectToken)
        .get(
          `/v1/projects/${newProjectId}/databases/(default)/documents/testCollection/${documentId}`
        );

      expect(readDocResponse.status).toBe(200);
      expect(readDocResponse.body.fields.title.stringValue).toBe(
        "Test Document"
      );
      expect(readDocResponse.body.fields.content.stringValue).toBe(
        "This is a test document"
      );

      // Read the collection
      const readCollectionResponse = await testHelper
        .authenticatedRequest(newProjectToken)
        .get(
          `/v1/projects/${newProjectId}/databases/(default)/documents/testCollection`
        );

      expect(readCollectionResponse.status).toBe(200);
      expect(readCollectionResponse.body.documents).toBeDefined();
      expect(Array.isArray(readCollectionResponse.body.documents)).toBe(true);
      expect(readCollectionResponse.body.documents.length).toBe(1);

      // Step 6: Verify user document can be accessed
      console.log("Step 6: Verifying user document access...");

      // Check if user was created in the basebase.users collection
      const usersCollection = testHelper.mongoClient
        .db("basebase")
        .collection("users");

      const userDoc = await usersCollection.findOne({
        phone: testPhoneNumber,
      });

      expect(userDoc).toBeDefined();
      expect(userDoc!._id).toBe("Test User"); // The actual username used in createTestUser
      expect(userDoc!.phone).toBe(testPhoneNumber);

      // Step 7: Verify project document can be accessed
      console.log("Step 7: Verifying project document access...");

      const projectsCollection = testHelper.mongoClient
        .db("basebase")
        .collection("projects");

      const projectDoc = await projectsCollection.findOne({
        _id: newProjectId,
      });

      expect(projectDoc).toBeDefined();
      expect(projectDoc!.name).toBe("MyNewProject");
      expect(projectDoc!.description).toBe("A project created via API");
      expect(projectDoc!.ownerId).toBeDefined();
      expect(projectDoc!.apiKey).toBe(newProjectApiKey);

      console.log("✅ Complete authentication and project flow test passed!");
    });

    test("should handle project creation with sanitized names", async () => {
      // Setup initial authentication
      await testHelper.createTestProject();
      const token = await testHelper.createTestUser();

      // Test project name sanitization
      const projectData = {
        name: "My Special Project!!! @#$%",
        description: "Testing name sanitization",
      };

      const response = await testHelper
        .authenticatedRequest(token)
        .post("/v1/projects")
        .send(projectData);

      expect(response.status).toBe(201);
      expect(response.body.project.fields.name.stringValue).toBe(
        "My Special Project!!! @#$%"
      );
      // The database name should be sanitized
      const projectId = response.body.project.name.split("/")[1];
      expect(projectId).toMatch(/^[a-z0-9_]+$/);
    });

    test("should prevent access to wrong project documents", async () => {
      // Create two projects
      await testHelper.createTestProject();
      const token = await testHelper.createTestUser();

      // Create first project
      const project1Response = await testHelper
        .authenticatedRequest(token)
        .post("/v1/projects")
        .send({
          name: "Project1",
          description: "First project",
        });

      expect(project1Response.status).toBe(201);
      const project1Id = project1Response.body.project.name.split("/")[1];

      // Create second project
      const project2Response = await testHelper
        .authenticatedRequest(token)
        .post("/v1/projects")
        .send({
          name: "Project2",
          description: "Second project",
        });

      expect(project2Response.status).toBe(201);
      const project2Id = project2Response.body.project.name.split("/")[1];

      // Get token for project1
      const codesCollection = testHelper.mongoClient
        .db("basebase")
        .collection("verification_codes");

      // Request new code
      await request(testHelper.app).post("/v1/requestCode").send({
        username: testUsername,
        phone: testPhoneNumber,
      });

      const codeDoc = await codesCollection.findOne({
        phone: testPhoneNumber,
      });

      const project1Token = await request(testHelper.app)
        .post("/v1/verifyCode")
        .send({
          phone: testPhoneNumber,
          code: codeDoc!.code,
          projectApiKey: project1Response.body.apiKey,
        });

      expect(project1Token.status).toBe(200);
      const p1Token = project1Token.body.token;

      // Try to create document in project2 using project1 token
      const documentData = {
        fields: {
          title: { stringValue: "Unauthorized Document" },
        },
      };

      const unauthorizedResponse = await testHelper
        .authenticatedRequest(p1Token)
        .post(
          `/v1/projects/${project2Id}/databases/(default)/documents/testCollection`
        )
        .send(documentData);

      // Should fail with permission error
      expect(unauthorizedResponse.status).toBe(403);
      expect(unauthorizedResponse.body.error).toContain(
        "only databases matching your project name"
      );

      // Test that "public" project allows anyone to create collections
      const publicDocumentData = {
        fields: {
          title: { stringValue: "Public Document" },
          content: { stringValue: "This should work in public project" },
        },
      };

      const publicResponse = await testHelper
        .authenticatedRequest(p1Token)
        .post(
          `/v1/projects/public/databases/(default)/documents/testCollection`
        )
        .send(publicDocumentData);

      // Should succeed because "public" project allows anyone to create collections
      expect(publicResponse.status).toBe(201);
      expect(publicResponse.body.fields.title.stringValue).toBe(
        "Public Document"
      );
    });
  });
});
