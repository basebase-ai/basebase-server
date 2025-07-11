# BaseBase Server Setup Guide

## Prerequisites

- Node.js (v14 or higher)
- MongoDB Atlas account

## Setup Steps

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Create environment file:**
   Create a `.env` file in the root directory with the following variables:

   ```
   MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/
   PORT=3000
   JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
   ```

3. **Configure MongoDB Atlas:**

   - Create a MongoDB Atlas cluster
   - Create a database user with read/write permissions
   - Whitelist your IP address
   - Copy the connection string to your `.env` file

4. **Start the server:**

   ```bash
   npm start
   ```

   For development with auto-reload:

   ```bash
   npm run dev
   ```

5. **Set up test project:**

   ```bash
   npm run setup
   ```

6. **Get JWT token (interactive):**

   ```bash
   npm run get-token
   ```

7. **Create a new project (interactive):**

   ```bash
   npm run create-project
   ```

8. **Test the server:**
   ```bash
   curl http://localhost:3000/health
   ```

## API Usage Examples

### Authentication Flow

#### 1. Request verification code:

```bash
curl -X POST http://localhost:3000/requestCode \
  -H "Content-Type: application/json" \
  -d '{
    "username": "John Doe",
    "phone": "+1234567890"
  }'
```

#### 2. Create a project (manual setup in MongoDB):

First, create a project document in `basebase.projects` collection:

```javascript
{
  "name": "My Project",
  "apiKey": "your-project-api-key",
  "createdAt": new Date()
}
```

#### 3. Verify code and get JWT token:

```bash
curl -X POST http://localhost:3000/verifyCode \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+1234567890",
    "code": "123456",
    "projectApiKey": "your-project-api-key"
  }'
```

### Project Management (require JWT token)

#### Create a project:

```bash
curl -X POST http://localhost:3000/projects \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "name": "My New Project",
    "description": "Project description"
  }'
```

**Note:** Project names are automatically sanitized:

- "My New Project" becomes "my_new_project" (database name)
- Display name preserves original formatting: "My New Project"
- Special characters are replaced with underscores in database name
- Database names are made unique with numbering if needed
- JWT tokens include the database name for fast database access

#### List your projects:

```bash
curl http://localhost:3000/projects \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

#### Regenerate API key:

```bash
curl -X POST http://localhost:3000/projects/PROJECT_ID/regenerate-key \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### CRUD Operations (require JWT token)

#### Create a document:

```bash
curl -X POST http://localhost:3000/myProject/users \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "fields": {
      "name": {"stringValue": "John Doe"},
      "age": {"integerValue": "30"}
    }
  }'
```

#### Read a document:

```bash
curl http://localhost:3000/myProject/users/DOCUMENT_ID \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

#### Update a document:

```bash
curl -X PATCH http://localhost:3000/myProject/users/DOCUMENT_ID \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "fields": {
      "age": {"integerValue": "31"}
    }
  }'
```

#### Delete a document:

```bash
curl -X DELETE http://localhost:3000/myProject/users/DOCUMENT_ID \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

#### Get all documents in a collection:

```bash
curl http://localhost:3000/myProject/users \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Path Structure

### Authentication Endpoints (no JWT required):

- `POST /requestCode` - Request verification code
- `POST /verifyCode` - Verify code and get JWT token

### Project Management Endpoints (JWT required):

- `POST /projects` - Create a new project
- `GET /projects` - List your projects
- `POST /projects/:projectId/regenerate-key` - Regenerate API key

### CRUD Endpoints (JWT required):

- `POST /projectName/collectionName` - Create document
- `GET /projectName/collectionName` - Read collection
- `GET /projectName/collectionName/documentId` - Read single document
- `PATCH /projectName/collectionName/documentId` - Update document
- `DELETE /projectName/collectionName/documentId` - Delete document

Where:

- `projectName` can be either the original project name or sanitized database name
- `collectionName` maps to MongoDB collection name
- The system automatically resolves project names to their sanitized database names

### Internal Collections:

The system uses the `basebase` database for internal collections:

- `basebase.users` - User accounts
- `basebase.projects` - Project configurations with API keys
- `basebase.verification_codes` - Temporary verification codes
