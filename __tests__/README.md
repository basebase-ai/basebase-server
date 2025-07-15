# BaseBase Server Tests

This directory contains comprehensive test suites for the BaseBase server API.

## Setup

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Set up MongoDB:**
   Make sure MongoDB is running locally on the default port (27017), or set the `MONGODB_URI` environment variable.

3. **Environment variables:**
   Create a `.env.test` file in the project root with:
   ```
   NODE_ENV=test
   PORT=3001
   MONGODB_URI=mongodb://localhost:27017
   JWT_SECRET=test-jwt-secret-key
   TWILIO_ACCOUNT_SID=test_account_sid
   TWILIO_AUTH_TOKEN=test_auth_token
   TWILIO_PHONE_NUMBER=+1234567890
   ```

## Running Tests

- **Run all tests:**

  ```bash
  npm test
  ```

- **Run tests in watch mode:**

  ```bash
  npm run test:watch
  ```

- **Run with coverage:**
  ```bash
  npm test -- --coverage
  ```

## Test Coverage

### Authentication Tests

- ✅ Request verification code
- ✅ Handle invalid phone numbers
- ✅ Missing authentication token handling
- ✅ Invalid authentication token handling

### Document Operations

- ✅ **addDoc (POST)** - Create documents with auto-generated IDs
- ✅ **getDoc (GET)** - Retrieve documents by ID
- ✅ **setDoc (PUT)** - Create/replace documents with specific IDs
- ✅ **updateDoc (PATCH)** - Update specific fields in existing documents

### Data Type Support

- ✅ String values
- ✅ Integer values
- ✅ Double/float values
- ✅ Boolean values

### Collection Operations

- ✅ List documents in collection
- ✅ Authentication requirements for collection access

### Error Handling

- ✅ Invalid project names
- ✅ Malformed JSON requests
- ✅ Non-existent documents
- ✅ Helpful error messages

### ID Format Support

- ✅ Auto-generated base64 IDs (72-bit)
- ✅ Custom string IDs (URL-safe)
- ✅ User-specified document identifiers

## Test Structure

- `test-utils.ts` - Helper utilities for test setup and common operations
- `api.test.ts` - Main API endpoint tests

### TestHelper Class

The `TestHelper` class provides:

- Server setup and teardown
- Test user creation with JWT tokens
- Database cleanup between tests
- Helper methods for authenticated requests
- Document creation utilities

## Notes

- Tests use a separate test database that gets cleaned up after each test run
- The test suite includes integration tests that test the full API flow
- Authentication is mocked for testing purposes
- All tests run against a real MongoDB instance to ensure database operations work correctly

## Troubleshooting

**MongoDB Connection Issues:**

- Ensure MongoDB is running: `brew services start mongodb/brew/mongodb-community`
- Check the connection string in `.env.test`

**Test Timeouts:**

- Tests have a 30-second timeout for database operations
- If tests are slow, check your MongoDB configuration

**Permission Errors:**

- Ensure the test database can be created and dropped
- Check MongoDB user permissions if using authentication
