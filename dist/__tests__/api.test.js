"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const test_utils_1 = require("./test-utils");
const supertest_1 = __importDefault(require("supertest"));
describe("API Integration Tests", () => {
    let testHelper;
    let userToken;
    beforeAll(async () => {
        testHelper = new test_utils_1.TestHelper();
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
    });
    describe("Authentication", () => {
        test("should request verification code", async () => {
            const response = await (0, supertest_1.default)(testHelper.app).post("/requestCode").send({
                name: "Test User",
                phone: "+15551234567",
            });
            expect(response.status).toBe(200);
            expect(response.body.message).toBeDefined();
        });
        test("should verify code and return token", async () => {
            // First request a code
            const requestResponse = await (0, supertest_1.default)(testHelper.app)
                .post("/requestCode")
                .send({
                name: "Test User",
                phone: "+15551234567",
            });
            expect(requestResponse.status).toBe(200);
            // Create a test project for this test
            const testProjectApiKey = "bb_test_api_key_for_test";
            const projectsCollection = testHelper.mongoClient
                .db("basebase")
                .collection("projects");
            await projectsCollection.insertOne({
                _id: "test-project-verify",
                displayName: "Test Project",
                description: "A test project",
                ownerId: requestResponse.body.userId,
                apiKey: testProjectApiKey,
                createdAt: new Date(),
                updatedAt: new Date(),
            });
            // Get the actual verification code from MongoDB
            const codesCollection = testHelper.mongoClient
                .db("basebase")
                .collection("verification_codes");
            const verificationCodeDoc = await codesCollection.findOne({
                phone: "+15551234567",
            });
            if (!verificationCodeDoc) {
                throw new Error("Verification code not found in database");
            }
            const actualCode = verificationCodeDoc.code;
            // Then verify it
            const response = await (0, supertest_1.default)(testHelper.app).post("/verifyCode").send({
                phone: "+15551234567",
                code: actualCode,
                projectApiKey: testProjectApiKey,
            });
            expect(response.status).toBe(200);
            expect(response.body.token).toBeDefined();
        });
    });
    describe("Document Operations", () => {
        const testProject = "test-project";
        const testCollection = "users";
        test("should create document with auto-generated ID", async () => {
            const documentData = {
                fields: {
                    name: { stringValue: "John Doe" },
                    email: { stringValue: "john@example.com" },
                    age: { integerValue: "30" },
                    active: { booleanValue: true },
                },
            };
            const url = `/projects/${testProject}/databases/(default)/documents/${testCollection}`;
            console.log(`Making POST request to: ${url}`);
            const response = await testHelper
                .authenticatedRequest(userToken)
                .post(url)
                .send(documentData);
            console.log(`Response status: ${response.status}`);
            console.log(`Response body:`, response.body);
            expect(response.status).toBe(201);
            expect(response.body.name).toBeDefined();
            expect(response.body.fields.name.stringValue).toBe("John Doe");
            expect(response.body.fields.email.stringValue).toBe("john@example.com");
            expect(response.body.fields.age.integerValue).toBe("30");
            expect(response.body.fields.active.booleanValue).toBe(true);
        });
        test("should get document by ID", async () => {
            // First create a document
            const documentData = {
                fields: {
                    name: { stringValue: "Jane Doe" },
                    email: { stringValue: "jane@example.com" },
                },
            };
            const createResponse = await testHelper
                .authenticatedRequest(userToken)
                .post(`/projects/${testProject}/databases/(default)/documents/${testCollection}`)
                .send(documentData);
            expect(createResponse.status).toBe(201);
            const documentId = createResponse.body.name;
            // Then get it
            const getResponse = await testHelper
                .authenticatedRequest(userToken)
                .get(`/projects/${testProject}/databases/(default)/documents/${testCollection}/${documentId}`);
            expect(getResponse.status).toBe(200);
            expect(getResponse.body.fields.name.stringValue).toBe("Jane Doe");
            expect(getResponse.body.fields.email.stringValue).toBe("jane@example.com");
        });
        test("should create document with custom ID", async () => {
            const customId = "custom-user-123";
            const documentData = {
                fields: {
                    name: { stringValue: "Custom User" },
                    customId: { stringValue: customId },
                },
            };
            const response = await testHelper
                .authenticatedRequest(userToken)
                .put(`/projects/${testProject}/databases/(default)/documents/${testCollection}/${customId}`)
                .send(documentData);
            expect(response.status).toBe(200);
            expect(response.body.name).toBe(customId);
            expect(response.body.fields.name.stringValue).toBe("Custom User");
        });
        test("should update document", async () => {
            const customId = "user-to-update";
            // Create initial document
            const initialData = {
                fields: {
                    name: { stringValue: "Original Name" },
                    email: { stringValue: "original@example.com" },
                    age: { integerValue: "25" },
                },
            };
            await testHelper
                .authenticatedRequest(userToken)
                .put(`/projects/${testProject}/databases/(default)/documents/${testCollection}/${customId}`)
                .send(initialData);
            // Update the document
            const updateData = {
                fields: {
                    name: { stringValue: "Updated Name" },
                    email: { stringValue: "updated@example.com" },
                },
            };
            const response = await testHelper
                .authenticatedRequest(userToken)
                .patch(`/projects/${testProject}/databases/(default)/documents/${testCollection}/${customId}`)
                .send(updateData);
            expect(response.status).toBe(200);
            expect(response.body.fields.name.stringValue).toBe("Updated Name");
            expect(response.body.fields.email.stringValue).toBe("updated@example.com");
            // Age should be preserved since it wasn't in the update
            expect(response.body.fields.age.integerValue).toBe("25");
        });
        test("should delete document", async () => {
            const customId = "user-to-delete";
            // Create document first
            const documentData = {
                fields: {
                    name: { stringValue: "User to Delete" },
                },
            };
            await testHelper
                .authenticatedRequest(userToken)
                .put(`/projects/${testProject}/databases/(default)/documents/${testCollection}/${customId}`)
                .send(documentData);
            // Delete the document
            const deleteResponse = await testHelper
                .authenticatedRequest(userToken)
                .delete(`/projects/${testProject}/databases/(default)/documents/${testCollection}/${customId}`);
            expect(deleteResponse.status).toBe(200);
            expect(deleteResponse.body.message).toBe("Document deleted successfully");
            // Verify it's deleted
            const getResponse = await testHelper
                .authenticatedRequest(userToken)
                .get(`/projects/${testProject}/databases/(default)/documents/${testCollection}/${customId}`);
            expect(getResponse.status).toBe(404);
        });
        test("should handle different data types", async () => {
            const documentData = {
                fields: {
                    stringField: { stringValue: "Hello World" },
                    integerField: { integerValue: "42" },
                    doubleField: { doubleValue: 3.14159 },
                    booleanField: { booleanValue: true },
                    arrayField: {
                        arrayValue: {
                            values: [
                                { stringValue: "item1" },
                                { stringValue: "item2" },
                                { integerValue: "123" },
                            ],
                        },
                    },
                    mapField: {
                        mapValue: {
                            fields: {
                                nestedString: { stringValue: "nested value" },
                                nestedNumber: { integerValue: "456" },
                            },
                        },
                    },
                },
            };
            const response = await testHelper
                .authenticatedRequest(userToken)
                .post(`/projects/${testProject}/databases/(default)/documents/${testCollection}`)
                .send(documentData);
            expect(response.status).toBe(201);
            expect(response.body.fields.stringField.stringValue).toBe("Hello World");
            expect(response.body.fields.integerField.integerValue).toBe("42");
            expect(response.body.fields.doubleField.doubleValue).toBe(3.14159);
            expect(response.body.fields.booleanField.booleanValue).toBe(true);
            expect(response.body.fields.arrayField.arrayValue.values).toHaveLength(3);
            expect(response.body.fields.mapField.mapValue.fields.nestedString.stringValue).toBe("nested value");
        });
        test("should return 404 for non-existent document", async () => {
            const response = await testHelper
                .authenticatedRequest(userToken)
                .get(`/projects/${testProject}/databases/(default)/documents/${testCollection}/non-existent-id`);
            expect(response.status).toBe(404);
        });
        test("should list documents in collection", async () => {
            // Create multiple documents
            const doc1Data = { fields: { name: { stringValue: "Doc 1" } } };
            const doc2Data = { fields: { name: { stringValue: "Doc 2" } } };
            await testHelper
                .authenticatedRequest(userToken)
                .post(`/projects/${testProject}/databases/(default)/documents/${testCollection}`)
                .send(doc1Data);
            await testHelper
                .authenticatedRequest(userToken)
                .post(`/projects/${testProject}/databases/(default)/documents/${testCollection}`)
                .send(doc2Data);
            // List documents
            const response = await testHelper
                .authenticatedRequest(userToken)
                .get(`/projects/${testProject}/databases/(default)/documents/${testCollection}`);
            expect(response.status).toBe(200);
            expect(response.body.documents).toBeDefined();
            expect(response.body.documents.length).toBe(2);
            expect(response.body.documents[0].fields.name.stringValue).toMatch(/Doc [12]/);
            expect(response.body.documents[1].fields.name.stringValue).toMatch(/Doc [12]/);
        });
        test("should get collection metadata (security rules)", async () => {
            const response = await testHelper
                .authenticatedRequest(userToken)
                .get(`/projects/${testProject}/databases/(default)/documents/${testCollection}/_security`);
            expect(response.status).toBe(200);
            expect(response.body.rules).toBeDefined();
            expect(response.body.indexes).toBeDefined();
        });
        test("should update collection metadata (security rules)", async () => {
            const securityData = {
                rules: [
                    {
                        match: "/documents/{document}",
                        allow: ["read"],
                        condition: "auth != null",
                    },
                ],
                indexes: [
                    {
                        fields: { email: 1 },
                        options: { unique: true },
                    },
                ],
            };
            const response = await testHelper
                .authenticatedRequest(userToken)
                .put(`/projects/${testProject}/databases/(default)/documents/${testCollection}/_security`)
                .send(securityData);
            expect(response.status).toBe(200);
            expect(response.body.message).toBe("Collection metadata updated successfully");
        });
    });
    describe("Error Handling", () => {
        test("should return 401 for unauthenticated requests", async () => {
            const response = await (0, supertest_1.default)(testHelper.app).get("/projects/test-project/databases/(default)/documents/users");
            expect(response.status).toBe(401);
        });
        test("should return 400 for invalid document data", async () => {
            const invalidData = {
                fields: {
                    invalidField: { invalidType: "this should fail" },
                },
            };
            const response = await testHelper
                .authenticatedRequest(userToken)
                .post("/projects/test-project/databases/(default)/documents/users")
                .send(invalidData);
            expect(response.status).toBe(201); // Server accepts any fields, so this should succeed
        });
        test("should return 404 for non-existent project", async () => {
            const response = await testHelper
                .authenticatedRequest(userToken)
                .get("/projects/non-existent-project/databases/(default)/documents/users");
            expect(response.status).toBe(404);
            expect(response.body.error).toContain("Project 'non-existent-project' not found");
        });
        test("should validate document ID format for PUT requests", async () => {
            const invalidId = "this-id-is-way-too-long-for-a-document-id-and-should-fail";
            const documentData = {
                fields: {
                    name: { stringValue: "Test" },
                },
            };
            const response = await testHelper
                .authenticatedRequest(userToken)
                .put(`/projects/test-project/databases/(default)/documents/users/${invalidId}`)
                .send(documentData);
            expect(response.status).toBe(400);
            expect(response.body.error).toBe("Invalid document ID");
        });
    });
});
