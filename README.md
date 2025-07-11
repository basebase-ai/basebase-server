# basebase-server

The BaseBase Server exposes an API for rapid, scalable storage and retrieval of JSON documents.

Documents are placed in Collections, and can be accessed via HTTP using structured paths and RESTful syntax.
Each Collection is owned by a Project, which defines the read/write access rules for Documents in that Collection.

## Authentication & Projects

Users authenticate via phone verification and receive JWT tokens scoped to specific projects. Each project has a unique API key that must be securely stored and cannot be retrieved after creation.

JWT tokens contain the database name (project.name) for fast database operations without lookup overhead.

### Project Name Rules

Project names are automatically sanitized to ensure MongoDB database compatibility:

- Converted to lowercase
- Spaces and special characters replaced with underscores
- Unique across all projects (numbered suffix added if needed)
- Maximum 60 characters (allows room for numbering)
- Cannot start with 'system' (reserved prefix)

## CRUD Operations

### CREATE - POST

Add document with auto-generated ID:

```
POST http://localhost:3000/PROJECT_NAME/COLLECTION_NAME

Body: {
  "fields": {
    "name": {"stringValue": "John Doe"},
    "age": {"integerValue": "30"}
  }
}
```

Add document with specific ID:

```
POST http://localhost:3000/PROJECT_NAME/COLLECTION_NAME?documentId=DOCUMENT_ID
```

### READ - GET

Get single document:

```
GET http://localhost:3000/PROJECT_NAME/COLLECTION_NAME/DOCUMENT_ID
```

Get collection:

```
GET http://localhost:3000/PROJECT_NAME/COLLECTION_NAME
```

### UPDATE - PATCH

Update specific fields:

```
PATCH http://localhost:3000/PROJECT_NAME/COLLECTION_NAME/DOCUMENT_ID

Body: {
  "fields": {
    "title": {"stringValue": "Updated Title"}
  }
}
```

### DELETE - DELETE

```
DELETE http://localhost:3000/PROJECT_NAME/COLLECTION_NAME/DOCUMENT_ID
```

## Security Rules

BaseBase automatically creates security rules for each collection using Firebase Security Rules syntax. When a new collection is created, default rules are initialized that allow all operations.

### Security Rules Structure

Each collection has security rules stored in the `security_rules` collection with the following structure:

```json
{
  "projectName": "project_database_name",
  "collectionName": "collection_name",
  "rules": [
    {
      "match": "/documents/{document}",
      "allow": ["read", "write"],
      "condition": "auth != null"
    }
  ],
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

### Managing Security Rules

#### Get Security Rules

```
GET http://localhost:3000/PROJECT_NAME/COLLECTION_NAME/_security
Authorization: Bearer JWT_TOKEN
```

#### Update Security Rules

```
PUT http://localhost:3000/PROJECT_NAME/COLLECTION_NAME/_security
Authorization: Bearer JWT_TOKEN

Body: {
  "rules": [
    {
      "match": "/documents/{document}",
      "allow": ["read", "write"],
      "condition": "auth != null"
    }
  ]
}
```

### Default Behavior

- **Empty rules array**: Allows all operations by everyone
- **Automatic initialization**: Rules are created when collections are first used
- **Firebase syntax**: Compatible with Firebase Security Rules syntax for easy migration

**Note**: Security rules are currently stored but not yet enforced. Rule enforcement will be implemented in a future update.

## Project Management

### Create Project

```
POST http://localhost:3000/projects
Authorization: Bearer JWT_TOKEN

Body: {
  "name": "My Project",
  "description": "Optional description"
}
```

### List Projects

```
GET http://localhost:3000/projects
Authorization: Bearer JWT_TOKEN
```

### Regenerate API Key

```
POST http://localhost:3000/projects/PROJECT_ID/regenerate-key
Authorization: Bearer JWT_TOKEN
```

## Path Structure

The API uses a simple path structure:

- `PROJECT_NAME` can be either the display name or database name
- `COLLECTION_NAME` maps to MongoDB collection name
- `DOCUMENT_ID` maps to MongoDB document `_id`

Examples:

- `POST /my-awesome-project/users` (display name)
- `POST /my_awesome_project/users` (database name)
  Both resolve to the same `my_awesome_project` database

## Data Format

The API uses Firestore-compatible data format with "fields" wrapper and explicit data types:

- `stringValue` for strings
- `integerValue` for integers (as strings)
- `doubleValue` for floating point numbers
- `booleanValue` for booleans
- `nullValue` for null values

## Quick Start

See `SETUP.md` for detailed setup instructions.

### Available Scripts

The project includes several utility scripts in the `scripts/` folder:

- `npm run get-token` - Interactive token generation
- `npm run create-project` - Create new projects
- `npm run setup-project` - Setup test project for development
- `npm run manage-security-rules` - Manage collection security rules
