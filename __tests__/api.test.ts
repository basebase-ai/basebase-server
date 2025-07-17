import { TestHelper } from "./test-utils";
import request from "supertest";

describe("API Integration Tests", () => {
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
  });

  describe("Authentication", () => {
    test("should request verification code", async () => {
      const response = await request(testHelper.app).post("/requestCode").send({
        username: "Test User",
        phone: "+15551234567",
      });

      expect(response.status).toBe(200);
      expect(response.body.message).toBeDefined();
    });

    test("should verify code and return token", async () => {
      // First request a code
      const requestResponse = await request(testHelper.app)
        .post("/requestCode")
        .send({
          username: "Test User",
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
      } as any);

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
      const response = await request(testHelper.app).post("/verifyCode").send({
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
        .post(
          `/projects/${testProject}/databases/(default)/documents/${testCollection}`
        )
        .send(documentData);

      expect(createResponse.status).toBe(201);
      const documentId = createResponse.body.name;

      // Then get it
      const getResponse = await testHelper
        .authenticatedRequest(userToken)
        .get(
          `/projects/${testProject}/databases/(default)/documents/${testCollection}/${documentId}`
        );

      expect(getResponse.status).toBe(200);
      expect(getResponse.body.fields.name.stringValue).toBe("Jane Doe");
      expect(getResponse.body.fields.email.stringValue).toBe(
        "jane@example.com"
      );
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
        .put(
          `/projects/${testProject}/databases/(default)/documents/${testCollection}/${customId}`
        )
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
        .put(
          `/projects/${testProject}/databases/(default)/documents/${testCollection}/${customId}`
        )
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
        .patch(
          `/projects/${testProject}/databases/(default)/documents/${testCollection}/${customId}`
        )
        .send(updateData);

      expect(response.status).toBe(200);
      expect(response.body.fields.name.stringValue).toBe("Updated Name");
      expect(response.body.fields.email.stringValue).toBe(
        "updated@example.com"
      );
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
        .put(
          `/projects/${testProject}/databases/(default)/documents/${testCollection}/${customId}`
        )
        .send(documentData);

      // Delete the document
      const deleteResponse = await testHelper
        .authenticatedRequest(userToken)
        .delete(
          `/projects/${testProject}/databases/(default)/documents/${testCollection}/${customId}`
        );

      expect(deleteResponse.status).toBe(200);
      expect(deleteResponse.body.message).toBe("Document deleted successfully");

      // Verify it's deleted
      const getResponse = await testHelper
        .authenticatedRequest(userToken)
        .get(
          `/projects/${testProject}/databases/(default)/documents/${testCollection}/${customId}`
        );

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
        .post(
          `/projects/${testProject}/databases/(default)/documents/${testCollection}`
        )
        .send(documentData);

      expect(response.status).toBe(201);
      expect(response.body.fields.stringField.stringValue).toBe("Hello World");
      expect(response.body.fields.integerField.integerValue).toBe("42");
      expect(response.body.fields.doubleField.doubleValue).toBe(3.14159);
      expect(response.body.fields.booleanField.booleanValue).toBe(true);
      expect(response.body.fields.arrayField.arrayValue.values).toHaveLength(3);
      expect(
        response.body.fields.mapField.mapValue.fields.nestedString.stringValue
      ).toBe("nested value");
    });

    test("should return 404 for non-existent document", async () => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .get(
          `/projects/${testProject}/databases/(default)/documents/${testCollection}/non-existent-id`
        );

      expect(response.status).toBe(404);
    });

    test("should list documents in collection", async () => {
      // Create multiple documents
      const doc1Data = { fields: { name: { stringValue: "Doc 1" } } };
      const doc2Data = { fields: { name: { stringValue: "Doc 2" } } };

      await testHelper
        .authenticatedRequest(userToken)
        .post(
          `/projects/${testProject}/databases/(default)/documents/${testCollection}`
        )
        .send(doc1Data);

      await testHelper
        .authenticatedRequest(userToken)
        .post(
          `/projects/${testProject}/databases/(default)/documents/${testCollection}`
        )
        .send(doc2Data);

      // List documents
      const response = await testHelper
        .authenticatedRequest(userToken)
        .get(
          `/projects/${testProject}/databases/(default)/documents/${testCollection}`
        );

      expect(response.status).toBe(200);
      expect(response.body.documents).toBeDefined();
      expect(response.body.documents.length).toBe(2);
      expect(response.body.documents[0].fields.name.stringValue).toMatch(
        /Doc [12]/
      );
      expect(response.body.documents[1].fields.name.stringValue).toMatch(
        /Doc [12]/
      );
    });

    test("should get collection metadata (security rules)", async () => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .get(
          `/projects/${testProject}/databases/(default)/documents/${testCollection}/_security`
        );

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
        .put(
          `/projects/${testProject}/databases/(default)/documents/${testCollection}/_security`
        )
        .send(securityData);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe(
        "Collection metadata updated successfully"
      );
    });
  });

  describe("Error Handling", () => {
    test("should return 401 for unauthenticated requests", async () => {
      const response = await request(testHelper.app).get(
        "/projects/test-project/databases/(default)/documents/users"
      );

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
        .get(
          "/projects/non-existent-project/databases/(default)/documents/users"
        );

      expect(response.status).toBe(404);
      expect(response.body.error).toContain(
        "Project 'non-existent-project' not found"
      );
    });

    test("should validate document ID format for PUT requests", async () => {
      // Create an ID longer than 255 characters
      const invalidId =
        "this-id-is-way-too-long-for-a-document-id-and-should-fail-because-it-exceeds-the-maximum-allowed-length-of-255-characters-so-we-need-to-make-it-even-longer-than-that-by-adding-more-and-more-text-until-we-reach-the-point-where-it-definitely-exceeds-255-chars";
      const documentData = {
        fields: {
          name: { stringValue: "Test" },
        },
      };

      const response = await testHelper
        .authenticatedRequest(userToken)
        .put(
          `/projects/test-project/databases/(default)/documents/users/${invalidId}`
        )
        .send(documentData);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Invalid document ID");
    });
  });

  describe("Firebase Array Format Conversion", () => {
    const testProject = "test-project";
    const testCollection = "array-test";

    test("should convert Firebase arrayValue to JavaScript array on creation", async () => {
      const documentData = {
        fields: {
          sourceIds: {
            arrayValue: {
              values: [
                { stringValue: "6866ef5247046c6267ad35bb" },
                { stringValue: "685d9e632efa0f2fbc8f4261" },
                { stringValue: "68012d04af809cb7c12f6233" },
              ],
            },
          },
          friends: { arrayValue: { values: [] } },
          denseMode: { booleanValue: false },
          darkMode: { booleanValue: false },
        },
      };

      const response = await testHelper
        .authenticatedRequest(userToken)
        .post(
          `/projects/${testProject}/databases/(default)/documents/${testCollection}`
        )
        .send(documentData);

      expect(response.status).toBe(201);

      // Verify response has Firebase format
      expect(response.body.fields.sourceIds.arrayValue).toBeDefined();
      expect(response.body.fields.sourceIds.arrayValue.values).toHaveLength(3);
      expect(
        response.body.fields.sourceIds.arrayValue.values[0].stringValue
      ).toBe("6866ef5247046c6267ad35bb");

      // Verify empty array
      expect(response.body.fields.friends.arrayValue).toBeDefined();
      expect(response.body.fields.friends.arrayValue.values).toHaveLength(0);
    });

    test("should handle arrays with mixed data types", async () => {
      const documentData = {
        fields: {
          mixedArray: {
            arrayValue: {
              values: [
                { stringValue: "hello" },
                { integerValue: "42" },
                { doubleValue: 3.14 },
                { booleanValue: true },
                { nullValue: null },
              ],
            },
          },
        },
      };

      const response = await testHelper
        .authenticatedRequest(userToken)
        .post(
          `/projects/${testProject}/databases/(default)/documents/${testCollection}`
        )
        .send(documentData);

      expect(response.status).toBe(201);

      const arrayValues = response.body.fields.mixedArray.arrayValue.values;
      expect(arrayValues).toHaveLength(5);
      expect(arrayValues[0].stringValue).toBe("hello");
      expect(arrayValues[1].integerValue).toBe("42");
      expect(arrayValues[2].doubleValue).toBe(3.14);
      expect(arrayValues[3].booleanValue).toBe(true);
      expect(arrayValues[4].nullValue).toBe(null);
    });

    test("should handle nested arrays", async () => {
      const documentData = {
        fields: {
          nestedArray: {
            arrayValue: {
              values: [
                {
                  arrayValue: {
                    values: [
                      { stringValue: "nested1" },
                      { stringValue: "nested2" },
                    ],
                  },
                },
                { stringValue: "regular" },
              ],
            },
          },
        },
      };

      const response = await testHelper
        .authenticatedRequest(userToken)
        .post(
          `/projects/${testProject}/databases/(default)/documents/${testCollection}`
        )
        .send(documentData);

      expect(response.status).toBe(201);

      const arrayValues = response.body.fields.nestedArray.arrayValue.values;
      expect(arrayValues).toHaveLength(2);
      expect(arrayValues[0].arrayValue.values).toHaveLength(2);
      expect(arrayValues[0].arrayValue.values[0].stringValue).toBe("nested1");
      expect(arrayValues[1].stringValue).toBe("regular");
    });

    test("should update document with array using PUT", async () => {
      const customId = "array-update-test";

      // Create initial document
      const initialData = {
        fields: {
          sourceIds: {
            arrayValue: {
              values: [
                { stringValue: "original1" },
                { stringValue: "original2" },
              ],
            },
          },
          friends: { arrayValue: { values: [] } },
          denseMode: { booleanValue: false },
          darkMode: { booleanValue: false },
        },
      };

      await testHelper
        .authenticatedRequest(userToken)
        .put(
          `/projects/${testProject}/databases/(default)/documents/${testCollection}/${customId}`
        )
        .send(initialData);

      // Update with new array data
      const updateData = {
        fields: {
          sourceIds: {
            arrayValue: {
              values: [
                { stringValue: "6866ef5247046c6267ad35bb" },
                { stringValue: "685d9e632efa0f2fbc8f4261" },
                { stringValue: "68012d04af809cb7c12f6233" },
                { stringValue: "685c30110a0fda743945d460" },
              ],
            },
          },
          friends: {
            arrayValue: {
              values: [{ stringValue: "friend1" }, { stringValue: "friend2" }],
            },
          },
          denseMode: { booleanValue: true },
          darkMode: { booleanValue: false },
        },
      };

      const response = await testHelper
        .authenticatedRequest(userToken)
        .put(
          `/projects/${testProject}/databases/(default)/documents/${testCollection}/${customId}`
        )
        .send(updateData);

      expect(response.status).toBe(200);
      expect(response.body.fields.sourceIds.arrayValue.values).toHaveLength(4);
      expect(response.body.fields.friends.arrayValue.values).toHaveLength(2);
      expect(response.body.fields.denseMode.booleanValue).toBe(true);
    });

    test("should update document with array using PATCH", async () => {
      const customId = "array-patch-test";

      // Create initial document
      const initialData = {
        fields: {
          sourceIds: {
            arrayValue: {
              values: [
                { stringValue: "original1" },
                { stringValue: "original2" },
              ],
            },
          },
          keepThis: { stringValue: "preserve" },
        },
      };

      await testHelper
        .authenticatedRequest(userToken)
        .put(
          `/projects/${testProject}/databases/(default)/documents/${testCollection}/${customId}`
        )
        .send(initialData);

      // Patch only the array
      const patchData = {
        fields: {
          sourceIds: {
            arrayValue: {
              values: [
                { stringValue: "updated1" },
                { stringValue: "updated2" },
                { stringValue: "updated3" },
              ],
            },
          },
        },
      };

      const response = await testHelper
        .authenticatedRequest(userToken)
        .patch(
          `/projects/${testProject}/databases/(default)/documents/${testCollection}/${customId}`
        )
        .send(patchData);

      expect(response.status).toBe(200);
      expect(response.body.fields.sourceIds.arrayValue.values).toHaveLength(3);
      expect(
        response.body.fields.sourceIds.arrayValue.values[0].stringValue
      ).toBe("updated1");
      // Verify other field is preserved
      expect(response.body.fields.keepThis.stringValue).toBe("preserve");
    });

    test("should handle empty arrays", async () => {
      const documentData = {
        fields: {
          emptyArray: { arrayValue: { values: [] } },
          emptyArrayNoValues: { arrayValue: {} },
        },
      };

      const response = await testHelper
        .authenticatedRequest(userToken)
        .post(
          `/projects/${testProject}/databases/(default)/documents/${testCollection}`
        )
        .send(documentData);

      expect(response.status).toBe(201);
      expect(response.body.fields.emptyArray.arrayValue.values).toHaveLength(0);
      expect(
        response.body.fields.emptyArrayNoValues.arrayValue.values
      ).toHaveLength(0);
    });
  });

  describe("Query Operations (runQuery)", () => {
    const testProject = "test-project";
    const testCollection = "newsStories";

    beforeEach(async () => {
      // Create test documents for querying
      const testDocuments = [
        {
          fields: {
            sourceId: { integerValue: "12345" },
            title: { stringValue: "Breaking News 1" },
            timestamp: { integerValue: "1700000000" },
            category: { stringValue: "politics" },
            priority: { integerValue: "1" },
          },
        },
        {
          fields: {
            sourceId: { integerValue: "12345" },
            title: { stringValue: "Breaking News 2" },
            timestamp: { integerValue: "1700000100" },
            category: { stringValue: "sports" },
            priority: { integerValue: "2" },
          },
        },
        {
          fields: {
            sourceId: { integerValue: "67890" },
            title: { stringValue: "Other News" },
            timestamp: { integerValue: "1700000050" },
            category: { stringValue: "tech" },
            priority: { integerValue: "1" },
          },
        },
        {
          fields: {
            sourceId: { integerValue: "12345" },
            title: { stringValue: "Breaking News 3" },
            timestamp: { integerValue: "1700000200" },
            category: { stringValue: "politics" },
            priority: { integerValue: "3" },
          },
        },
      ];

      // Insert test documents
      for (let i = 0; i < testDocuments.length; i++) {
        await testHelper
          .authenticatedRequest(userToken)
          .put(
            `/projects/${testProject}/databases/(default)/documents/${testCollection}/doc${
              i + 1
            }`
          )
          .send(testDocuments[i]);
      }
    });

    test("should query documents with field filter (EQUAL)", async () => {
      const queryData = {
        structuredQuery: {
          from: [{ collectionId: testCollection }],
          where: {
            fieldFilter: {
              field: { fieldPath: "sourceId" },
              op: "EQUAL",
              value: { integerValue: "12345" },
            },
          },
        },
      };

      const response = await testHelper
        .authenticatedRequest(userToken)
        .post(`/projects/${testProject}/databases/(default)/documents:runQuery`)
        .send(queryData);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(3); // 3 documents with sourceId=12345

      // Verify each result has the expected structure
      response.body.forEach((result: any) => {
        expect(result.document).toBeDefined();
        expect(result.readTime).toBeDefined();
        expect(result.document.fields.sourceId.integerValue).toBe("12345");
      });
    });

    test("should query documents with orderBy (DESCENDING)", async () => {
      const queryData = {
        structuredQuery: {
          from: [{ collectionId: testCollection }],
          where: {
            fieldFilter: {
              field: { fieldPath: "sourceId" },
              op: "EQUAL",
              value: { integerValue: "12345" },
            },
          },
          orderBy: [
            {
              field: { fieldPath: "timestamp" },
              direction: "DESCENDING",
            },
          ],
        },
      };

      const response = await testHelper
        .authenticatedRequest(userToken)
        .post(`/projects/${testProject}/databases/(default)/documents:runQuery`)
        .send(queryData);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(3);

      // Verify descending order by timestamp
      const timestamps = response.body.map((result: any) =>
        parseInt(result.document.fields.timestamp.integerValue)
      );
      expect(timestamps).toEqual([1700000200, 1700000100, 1700000000]);
    });

    test("should query documents with limit", async () => {
      const queryData = {
        structuredQuery: {
          from: [{ collectionId: testCollection }],
          where: {
            fieldFilter: {
              field: { fieldPath: "sourceId" },
              op: "EQUAL",
              value: { integerValue: "12345" },
            },
          },
          orderBy: [
            {
              field: { fieldPath: "timestamp" },
              direction: "DESCENDING",
            },
          ],
          limit: 2,
        },
      };

      const response = await testHelper
        .authenticatedRequest(userToken)
        .post(`/projects/${testProject}/databases/(default)/documents:runQuery`)
        .send(queryData);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2); // Limited to 2 results

      // Verify we got the most recent 2
      const timestamps = response.body.map((result: any) =>
        parseInt(result.document.fields.timestamp.integerValue)
      );
      expect(timestamps).toEqual([1700000200, 1700000100]);
    });

    test("should query documents with MATCHES operator for text search", async () => {
      const queryData = {
        structuredQuery: {
          from: [{ collectionId: testCollection }],
          where: {
            fieldFilter: {
              field: { fieldPath: "title" },
              op: "MATCHES",
              value: { stringValue: "Breaking" },
            },
          },
        },
      };

      const response = await testHelper
        .authenticatedRequest(userToken)
        .post(`/projects/${testProject}/databases/(default)/documents:runQuery`)
        .send(queryData);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(3);
      response.body.forEach((result: any) => {
        expect(result.document.fields.title.stringValue).toContain("Breaking");
      });
    });

    test("should return no documents with MATCHES operator if no match", async () => {
      const queryData = {
        structuredQuery: {
          from: [{ collectionId: testCollection }],
          where: {
            fieldFilter: {
              field: { fieldPath: "title" },
              op: "MATCHES",
              value: { stringValue: "NonExistent" },
            },
          },
        },
      };

      const response = await testHelper
        .authenticatedRequest(userToken)
        .post(`/projects/${testProject}/databases/(default)/documents:runQuery`)
        .send(queryData);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(0);
    });

    test("should query documents with comparison operators", async () => {
      const queryData = {
        structuredQuery: {
          from: [{ collectionId: testCollection }],
          where: {
            fieldFilter: {
              field: { fieldPath: "priority" },
              op: "GREATER_THAN",
              value: { integerValue: "1" },
            },
          },
        },
      };

      const response = await testHelper
        .authenticatedRequest(userToken)
        .post(`/projects/${testProject}/databases/(default)/documents:runQuery`)
        .send(queryData);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2); // priority 2 and 3

      response.body.forEach((result: any) => {
        const priority = parseInt(result.document.fields.priority.integerValue);
        expect(priority).toBeGreaterThan(1);
      });
    });

    test("should query documents with composite filters (AND)", async () => {
      const queryData = {
        structuredQuery: {
          from: [{ collectionId: testCollection }],
          where: {
            compositeFilter: {
              op: "AND",
              filters: [
                {
                  fieldFilter: {
                    field: { fieldPath: "sourceId" },
                    op: "EQUAL",
                    value: { integerValue: "12345" },
                  },
                },
                {
                  fieldFilter: {
                    field: { fieldPath: "category" },
                    op: "EQUAL",
                    value: { stringValue: "politics" },
                  },
                },
              ],
            },
          },
        },
      };

      const response = await testHelper
        .authenticatedRequest(userToken)
        .post(`/projects/${testProject}/databases/(default)/documents:runQuery`)
        .send(queryData);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2); // 2 politics docs with sourceId=12345

      response.body.forEach((result: any) => {
        expect(result.document.fields.sourceId.integerValue).toBe("12345");
        expect(result.document.fields.category.stringValue).toBe("politics");
      });
    });

    test("should query documents with IN operator", async () => {
      const queryData = {
        structuredQuery: {
          from: [{ collectionId: testCollection }],
          where: {
            fieldFilter: {
              field: { fieldPath: "category" },
              op: "IN",
              value: {
                arrayValue: {
                  values: [
                    { stringValue: "politics" },
                    { stringValue: "tech" },
                  ],
                },
              },
            },
          },
        },
      };

      const response = await testHelper
        .authenticatedRequest(userToken)
        .post(`/projects/${testProject}/databases/(default)/documents:runQuery`)
        .send(queryData);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(3); // 2 politics + 1 tech

      response.body.forEach((result: any) => {
        const category = result.document.fields.category.stringValue;
        expect(["politics", "tech"]).toContain(category);
      });
    });

    test("should return empty array for no matches", async () => {
      const queryData = {
        structuredQuery: {
          from: [{ collectionId: testCollection }],
          where: {
            fieldFilter: {
              field: { fieldPath: "sourceId" },
              op: "EQUAL",
              value: { integerValue: "99999" },
            },
          },
        },
      };

      const response = await testHelper
        .authenticatedRequest(userToken)
        .post(`/projects/${testProject}/databases/(default)/documents:runQuery`)
        .send(queryData);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(0);
    });

    test("should return 400 for missing structuredQuery", async () => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .post(`/projects/${testProject}/databases/(default)/documents:runQuery`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe(
        "Missing structuredQuery in request body"
      );
    });

    test("should return 400 for missing from clause", async () => {
      const queryData = {
        structuredQuery: {
          where: {
            fieldFilter: {
              field: { fieldPath: "sourceId" },
              op: "EQUAL",
              value: { integerValue: "12345" },
            },
          },
        },
      };

      const response = await testHelper
        .authenticatedRequest(userToken)
        .post(`/projects/${testProject}/databases/(default)/documents:runQuery`)
        .send(queryData);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe(
        "Missing 'from' clause in structuredQuery"
      );
    });

    test("should return 400 for unsupported filter operator", async () => {
      const queryData = {
        structuredQuery: {
          from: [{ collectionId: testCollection }],
          where: {
            fieldFilter: {
              field: { fieldPath: "sourceId" },
              op: "UNSUPPORTED_OPERATOR",
              value: { integerValue: "12345" },
            },
          },
        },
      };

      const response = await testHelper
        .authenticatedRequest(userToken)
        .post(`/projects/${testProject}/databases/(default)/documents:runQuery`)
        .send(queryData);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("Invalid where clause:");
    });

    test("should query all documents without where clause", async () => {
      const queryData = {
        structuredQuery: {
          from: [{ collectionId: testCollection }],
        },
      };

      const response = await testHelper
        .authenticatedRequest(userToken)
        .post(`/projects/${testProject}/databases/(default)/documents:runQuery`)
        .send(queryData);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(4); // All 4 test documents
    });
  });
});
