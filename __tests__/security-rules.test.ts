import { TestHelper } from "./test-utils";
import request from "supertest";
import jwt from "jsonwebtoken";

describe("Security Rules and Owner-Based Access Control", () => {
  let testHelper: TestHelper;
  const JWT_SECRET = process.env.JWT_SECRET || "test-secret-key";

  // Test users
  let user1Token: string;
  let user1Info: any;
  let user2Token: string;
  let user2Info: any;
  let projectId: string;

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

  beforeEach(async () => {
    // Create test project and two users for security testing
    await testHelper.createTestProject();
    user1Token = await testHelper.createTestUser();

    // Decode user1 info
    const decoded1 = jwt.verify(user1Token, JWT_SECRET) as any;
    user1Info = decoded1;

    // Create a second user by manually inserting a different user into the database
    // This simulates a truly different user with different userId
    const user2Id = "test-user-2";
    const user2Phone = "+15551234569";

    // Manually insert user2 into the database
    const usersCollection = testHelper.mongoClient
      .db("basebase")
      .collection("users");
    await usersCollection.insertOne({
      username: "Test User 2",
      phone: user2Phone,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any); // Allow MongoDB to auto-generate _id

    // Generate JWT token for user2 manually
    user2Token = jwt.sign(
      {
        userId: user2Id,
        projectId: "test-project",
        projectName: "test-project",
        phone: user2Phone,
      },
      JWT_SECRET
    );

    user2Info = {
      userId: user2Id,
      projectId: "test-project",
      projectName: "test-project",
      phone: user2Phone,
    };

    projectId = user1Info.projectName;
  });

  describe("Document Creation Security", () => {
    test("should automatically set ownerId when creating documents", async () => {
      const documentData = {
        fields: {
          title: { stringValue: "Test Document" },
          content: { stringValue: "This is a test document" },
        },
      };

      const response = await testHelper
        .authenticatedRequest(user1Token)
        .post(
          `/v1/projects/${projectId}/databases/(default)/documents/test_collection`
        )
        .send(documentData);

      expect(response.status).toBe(201);
      expect(response.body.fields).toBeDefined();
      expect(response.body.fields.ownerId).toBeDefined();
      expect(response.body.fields.ownerId.stringValue).toBe(user1Info.userId);
      expect(response.body.fields.createTime).toBeDefined();
      expect(response.body.fields.updateTime).toBeDefined();
    });

    test("should automatically apply security rules to new collections", async () => {
      // Create a document in a new collection
      const documentData = {
        fields: {
          title: { stringValue: "Test Document" },
        },
      };

      await testHelper
        .authenticatedRequest(user1Token)
        .post(
          `/v1/projects/${projectId}/databases/(default)/documents/new_secure_collection`
        )
        .send(documentData);

      // Check that security rules were automatically applied
      const rulesResponse = await testHelper
        .authenticatedRequest(user1Token)
        .get(
          `/v1/projects/${projectId}/databases/(default)/documents/new_secure_collection/_security`
        );

      expect(rulesResponse.status).toBe(200);
      expect(rulesResponse.body.rules).toBeDefined();
      expect(rulesResponse.body.rules.length).toBeGreaterThan(0);

      // Should have ownerId-based rules
      const writeRule = rulesResponse.body.rules.find(
        (rule: any) =>
          rule.allow.includes("write") && rule.condition.includes("ownerId")
      );
      expect(writeRule).toBeDefined();
    });
  });

  describe("Owner-Based Update Security", () => {
    let documentId: string;

    beforeEach(async () => {
      // Create a document owned by user1
      const documentData = {
        fields: {
          title: { stringValue: "User1's Document" },
          content: { stringValue: "Original content" },
          priority: { integerValue: "1" },
        },
      };

      const response = await testHelper
        .authenticatedRequest(user1Token)
        .post(
          `/v1/projects/${projectId}/databases/(default)/documents/test_collection`
        )
        .send(documentData);

      expect(response.status).toBe(201);
      documentId = response.body.name.split("/").pop();
    });

    test("should allow owner to update their own documents", async () => {
      const updateData = {
        fields: {
          title: { stringValue: "Updated Title" },
          newField: { stringValue: "Added field" },
        },
      };

      const response = await testHelper
        .authenticatedRequest(user1Token)
        .patch(
          `/v1/projects/${projectId}/databases/(default)/documents/test_collection/${documentId}`
        )
        .send(updateData);

      expect(response.status).toBe(200);
      expect(response.body.fields.title.stringValue).toBe("Updated Title");
      expect(response.body.fields.newField.stringValue).toBe("Added field");
      // Original fields should be preserved
      expect(response.body.fields.content.stringValue).toBe("Original content");
      expect(response.body.fields.priority.integerValue).toBe("1");
      // ownerId should be unchanged
      expect(response.body.fields.ownerId.stringValue).toBe(user1Info.userId);
    });

    test("should prevent non-owner from updating documents", async () => {
      const updateData = {
        fields: {
          title: { stringValue: "Malicious Update" },
        },
      };

      const response = await testHelper
        .authenticatedRequest(user2Token)
        .patch(
          `/v1/projects/${projectId}/databases/(default)/documents/test_collection/${documentId}`
        )
        .send(updateData);

      expect(response.status).toBe(403);
      expect(response.body.error).toContain("Access denied");
      expect(response.body.suggestion).toContain(
        "You can only modify or delete documents that you own"
      );
      expect(response.body.details).toBeDefined();
      expect(response.body.details.requiredOwner).toBe(user1Info.userId);
      expect(response.body.details.currentUser).toBe(user2Info.userId);
    });

    test("should merge fields on PUT operations for owners", async () => {
      const putData = {
        fields: {
          title: { stringValue: "PUT Updated Title" },
          category: { stringValue: "New Category" },
        },
      };

      const response = await testHelper
        .authenticatedRequest(user1Token)
        .put(
          `/v1/projects/${projectId}/databases/(default)/documents/test_collection/${documentId}`
        )
        .send(putData);

      expect(response.status).toBe(200);
      expect(response.body.fields.title.stringValue).toBe("PUT Updated Title");
      expect(response.body.fields.category.stringValue).toBe("New Category");
      // Original fields should be preserved (field merging)
      expect(response.body.fields.content.stringValue).toBe("Original content");
      expect(response.body.fields.priority.integerValue).toBe("1");
      // Immutable fields should be preserved
      expect(response.body.fields.ownerId.stringValue).toBe(user1Info.userId);
      expect(response.body.fields.createTime).toBeDefined();
      expect(response.body.fields.updateTime).toBeDefined();
    });

    test("should prevent non-owner from using PUT operations", async () => {
      const putData = {
        fields: {
          title: { stringValue: "Malicious PUT" },
        },
      };

      const response = await testHelper
        .authenticatedRequest(user2Token)
        .put(
          `/v1/projects/${projectId}/databases/(default)/documents/test_collection/${documentId}`
        )
        .send(putData);

      expect(response.status).toBe(403);
      expect(response.body.error).toContain("Access denied");
    });
  });

  describe("Owner-Based Delete Security", () => {
    let documentId: string;

    beforeEach(async () => {
      // Create a document owned by user1
      const documentData = {
        fields: {
          title: { stringValue: "Document to Delete" },
        },
      };

      const response = await testHelper
        .authenticatedRequest(user1Token)
        .post(
          `/v1/projects/${projectId}/databases/(default)/documents/test_collection`
        )
        .send(documentData);

      expect(response.status).toBe(201);
      documentId = response.body.name.split("/").pop();
    });

    test("should allow owner to delete their own documents", async () => {
      const response = await testHelper
        .authenticatedRequest(user1Token)
        .delete(
          `/v1/projects/${projectId}/databases/(default)/documents/test_collection/${documentId}`
        );

      expect(response.status).toBe(200);
      expect(response.body.message).toContain("deleted successfully");
      expect(response.body.documentId).toBe(documentId);

      // Verify document is actually deleted
      const getResponse = await testHelper
        .authenticatedRequest(user1Token)
        .get(
          `/v1/projects/${projectId}/databases/(default)/documents/test_collection/${documentId}`
        );

      expect(getResponse.status).toBe(404);
    });

    test("should prevent non-owner from deleting documents", async () => {
      const response = await testHelper
        .authenticatedRequest(user2Token)
        .delete(
          `/v1/projects/${projectId}/databases/(default)/documents/test_collection/${documentId}`
        );

      expect(response.status).toBe(403);
      expect(response.body.error).toContain("Access denied");
      expect(response.body.suggestion).toContain(
        "You can only modify or delete documents that you own"
      );

      // Verify document still exists
      const getResponse = await testHelper
        .authenticatedRequest(user1Token)
        .get(
          `/v1/projects/${projectId}/databases/(default)/documents/test_collection/${documentId}`
        );

      expect(getResponse.status).toBe(200);
    });
  });

  describe("Backward Compatibility", () => {
    test("should handle documents without ownerId gracefully", async () => {
      // Manually insert a document without ownerId (simulating legacy data)
      const collection = testHelper.mongoClient
        .db(projectId)
        .collection("legacy_collection");

      const legacyDoc = {
        title: "Legacy Document",
        createTime: new Date(),
        updateTime: new Date(),
        // Note: no ownerId field, let MongoDB auto-generate _id
      };

      const insertResult = await collection.insertOne(legacyDoc);
      const legacyDocId = insertResult.insertedId.toString();

      // Both users should be able to access/modify legacy documents
      const updateData = {
        fields: {
          title: { stringValue: "Updated Legacy Document" },
        },
      };

      const response1 = await testHelper
        .authenticatedRequest(user1Token)
        .patch(
          `/v1/projects/${projectId}/databases/(default)/documents/legacy_collection/${legacyDocId}`
        )
        .send(updateData);

      // Should work with a warning (not fail)
      expect(response1.status).toBe(200);

      const response2 = await testHelper
        .authenticatedRequest(user2Token)
        .patch(
          `/v1/projects/${projectId}/databases/(default)/documents/legacy_collection/${legacyDocId}`
        )
        .send(updateData);

      // Should also work for user2 (backward compatibility)
      expect(response2.status).toBe(200);
    });
  });

  describe("Field Protection", () => {
    let documentId: string;

    beforeEach(async () => {
      const documentData = {
        fields: {
          title: { stringValue: "Protected Fields Test" },
          content: { stringValue: "Original content" },
        },
      };

      const response = await testHelper
        .authenticatedRequest(user1Token)
        .post(
          `/v1/projects/${projectId}/databases/(default)/documents/test_collection`
        )
        .send(documentData);

      documentId = response.body.name.split("/").pop();
    });

    test("should protect immutable fields during updates", async () => {
      const maliciousUpdate = {
        fields: {
          title: { stringValue: "Updated Title" },
          ownerId: { stringValue: user2Info.userId }, // Try to change ownership
          createTime: { timestampValue: "2020-01-01T00:00:00.000Z" }, // Try to change creation time
          _id: { stringValue: "malicious-id" }, // Try to change ID
        },
      };

      const response = await testHelper
        .authenticatedRequest(user1Token)
        .patch(
          `/v1/projects/${projectId}/databases/(default)/documents/test_collection/${documentId}`
        )
        .send(maliciousUpdate);

      expect(response.status).toBe(200);
      expect(response.body.fields.title.stringValue).toBe("Updated Title"); // Should update
      expect(response.body.fields.ownerId.stringValue).toBe(user1Info.userId); // Should remain unchanged
      expect(response.body.fields.createTime).toBeDefined(); // Should remain unchanged
      expect(response.body.name.split("/").pop()).toBe(documentId); // ID should remain unchanged
    });

    test("should preserve all existing fields during partial updates", async () => {
      // First, add more fields to the document
      const initialUpdate = {
        fields: {
          category: { stringValue: "Important" },
          priority: { integerValue: "5" },
          tags: {
            arrayValue: {
              values: [{ stringValue: "urgent" }, { stringValue: "business" }],
            },
          },
        },
      };

      await testHelper
        .authenticatedRequest(user1Token)
        .patch(
          `/v1/projects/${projectId}/databases/(default)/documents/test_collection/${documentId}`
        )
        .send(initialUpdate);

      // Now do a partial update that only changes one field
      const partialUpdate = {
        fields: {
          title: { stringValue: "Partially Updated Title" },
        },
      };

      const response = await testHelper
        .authenticatedRequest(user1Token)
        .patch(
          `/v1/projects/${projectId}/databases/(default)/documents/test_collection/${documentId}`
        )
        .send(partialUpdate);

      expect(response.status).toBe(200);
      expect(response.body.fields.title.stringValue).toBe(
        "Partially Updated Title"
      );
      // All other fields should be preserved
      expect(response.body.fields.content.stringValue).toBe("Original content");
      expect(response.body.fields.category.stringValue).toBe("Important");
      expect(response.body.fields.priority.integerValue).toBe("5");
      expect(response.body.fields.tags.arrayValue.values).toHaveLength(2);
      expect(response.body.fields.ownerId.stringValue).toBe(user1Info.userId);
    });
  });

  describe("Read Access Control", () => {
    test("should allow all authenticated users to read documents", async () => {
      // Create document as user1
      const documentData = {
        fields: {
          title: { stringValue: "Readable Document" },
        },
      };

      const createResponse = await testHelper
        .authenticatedRequest(user1Token)
        .post(
          `/v1/projects/${projectId}/databases/(default)/documents/test_collection`
        )
        .send(documentData);

      const documentId = createResponse.body.name.split("/").pop();

      // User2 should be able to read it (current rule: read allowed for all)
      const readResponse = await testHelper
        .authenticatedRequest(user2Token)
        .get(
          `/v1/projects/${projectId}/databases/(default)/documents/test_collection/${documentId}`
        );

      expect(readResponse.status).toBe(200);
      expect(readResponse.body.fields.title.stringValue).toBe(
        "Readable Document"
      );
      expect(readResponse.body.fields.ownerId.stringValue).toBe(
        user1Info.userId
      );
    });

    test("should require authentication for reading documents", async () => {
      // Create document as user1
      const documentData = {
        fields: {
          title: { stringValue: "Protected Document" },
        },
      };

      const createResponse = await testHelper
        .authenticatedRequest(user1Token)
        .post(
          `/v1/projects/${projectId}/databases/(default)/documents/test_collection`
        )
        .send(documentData);

      const documentId = createResponse.body.name.split("/").pop();

      // Unauthenticated request should fail
      const readResponse = await request(testHelper.app).get(
        `/v1/projects/${projectId}/databases/(default)/documents/test_collection/${documentId}`
      );

      expect(readResponse.status).toBe(401);
      expect(readResponse.body.error).toContain("Access token required");
    });
  });
});
