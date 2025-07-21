import { TestHelper } from "./test-utils";

describe("Collection Naming Validation", () => {
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
  });

  describe("Valid Collection Names", () => {
    test.each([
      "users",
      "user_profiles",
      "order-items",
      "api_keys",
      "test123",
      "a",
    ])("should accept valid collection name: '%s'", async (collectionName) => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .post(
          `/v1/projects/test-project/databases/(default)/documents/${collectionName}`
        )
        .send({
          fields: {
            test: { stringValue: "value" },
          },
        });

      expect(response.status).toBe(201);
    });
  });

  describe("Invalid Collection Names", () => {
    test.each([
      "userProfiles",
      "OrderItems",
      "ApiKeys",
      "Users",
      "CamelCase",
      "someCamelCase",
      "UserProfile",
    ])(
      "should reject invalid collection name: '%s'",
      async (collectionName) => {
        const response = await testHelper
          .authenticatedRequest(userToken)
          .post(
            `/v1/projects/test-project/databases/(default)/documents/${collectionName}`
          )
          .send({
            fields: {
              test: { stringValue: "value" },
            },
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe("Invalid collection name");
        expect(response.body.suggestion).toContain(
          "lowercase with underscores/hyphens only"
        );
      }
    );
  });

  describe("Validation Across All Endpoints", () => {
    const invalidCollectionName = "userProfiles";

    test("should validate on POST (create document)", async () => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .post(
          `/v1/projects/test-project/databases/(default)/documents/${invalidCollectionName}`
        )
        .send({
          fields: { test: { stringValue: "value" } },
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Invalid collection name");
    });

    test("should validate on PUT (set document)", async () => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .put(
          `/v1/projects/test-project/databases/(default)/documents/${invalidCollectionName}/doc123`
        )
        .send({
          fields: { test: { stringValue: "value" } },
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Invalid collection name");
    });

    test("should validate on GET (read collection)", async () => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .get(
          `/v1/projects/test-project/databases/(default)/documents/${invalidCollectionName}`
        );

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Invalid collection name");
    });

    test("should validate on GET (read document)", async () => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .get(
          `/v1/projects/test-project/databases/(default)/documents/${invalidCollectionName}/doc123`
        );

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Invalid collection name");
    });

    test("should validate on PATCH (update document)", async () => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .patch(
          `/v1/projects/test-project/databases/(default)/documents/${invalidCollectionName}/doc123`
        )
        .send({
          fields: { test: { stringValue: "updated" } },
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Invalid collection name");
    });

    test("should validate on DELETE (delete document)", async () => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .delete(
          `/v1/projects/test-project/databases/(default)/documents/${invalidCollectionName}/doc123`
        );

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Invalid collection name");
    });

    test("should validate on GET security rules", async () => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .get(
          `/v1/projects/test-project/databases/(default)/documents/${invalidCollectionName}/_security`
        );

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Invalid collection name");
    });

    test("should validate on PUT security rules", async () => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .put(
          `/v1/projects/test-project/databases/(default)/documents/${invalidCollectionName}/_security`
        )
        .send({
          rules: [],
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Invalid collection name");
    });

    test("should validate on POST runQuery", async () => {
      const response = await testHelper
        .authenticatedRequest(userToken)
        .post(
          "/v1/projects/test-project/databases/(default)/documents:runQuery"
        )
        .send({
          structuredQuery: {
            from: [{ collectionId: invalidCollectionName }],
          },
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Invalid collection name");
    });
  });
});
