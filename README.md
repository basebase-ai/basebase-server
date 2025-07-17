# basebase-server

The BaseBase Server exposes an API for rapid, scalable storage and retrieval of JSON documents.

Documents are placed in Collections, and can be accessed via HTTP using structured paths and RESTful syntax.
Each Collection is owned by a Project, which defines the read/write access rules for Documents in that Collection.

## Authentication & Projects

Users authenticate via SMS phone verification and receive JWT tokens scoped to specific projects. Verification codes are sent via Twilio SMS to the provided phone number. Each project has a unique API key that must be securely stored and cannot be retrieved after creation.

JWT tokens contain the database name (project.name) for fast database operations without lookup overhead.

### Getting a JWT Token

To authenticate and get a JWT token, follow these steps:

#### Step 1: Request Verification Code

```
POST http://localhost:8000/requestCode

Body: {
  "username": "your_username",
  "phone": "+1234567890"
}
```

This will send an SMS verification code to the provided phone number and create a user account if it doesn't exist.

#### Step 2: Verify Code and Get JWT

```
POST http://localhost:8000/verifyCode

Body: {
  "phone": "+1234567890",
  "code": "123456",
  "projectApiKey": "bb_your_project_api_key_here"
}
```

**Response:**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "name": "users/user_id_id",
    "fields": {
      "name": { "stringValue": "your_username" },
      "phone": { "stringValue": "+1234567890" },
      "createdAt": { "timestampValue": "2024-01-01T00:00:00.000Z" },
      "updatedAt": { "timestampValue": "2024-01-01T00:00:00.000Z" }
    }
  },
  "project": {
    "name": "projects/project_id_id",
    "fields": {
      "name": { "stringValue": "My Project" },
      "description": { "stringValue": "Project description" },
      "ownerId": { "stringValue": "user_id_id" },
      "createdAt": { "timestampValue": "2024-01-01T00:00:00.000Z" },
      "updatedAt": { "timestampValue": "2024-01-01T00:00:00.000Z" }
    }
  }
}
```

#### Step 3: Use JWT Token

Include the JWT token in the Authorization header for all API requests:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Note:** You need a valid project API key to complete authentication. See the Project Management section below for creating projects.

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
POST http://localhost:8000/projects/PROJECT_ID/databases/(default)/documents/COLLECTION_ID

Body: {
  "fields": {
    "name": {"stringValue": "John Doe"},
    "age": {"integerValue": "30"}
  }
}
```

**Note:** POST creates documents with auto-generated `_id` IDs (72-bit base64 strings). To create or replace a document with a specific ID, use the PUT endpoint instead.

### READ - GET

Get single document:

```
GET http://localhost:8000/projects/PROJECT_ID/databases/(default)/documents/COLLECTION_ID/DOCUMENT_ID
```

Get collection:

```
GET http://localhost:8000/projects/PROJECT_ID/databases/(default)/documents/COLLECTION_ID
```

### UPDATE - PATCH

Update specific fields:

```
PATCH http://localhost:8000/projects/PROJECT_ID/databases/(default)/documents/COLLECTION_ID/DOCUMENT_ID

Body: {
  "fields": {
    "title": {"stringValue": "Updated Title"}
  }
}
```

### SET - PUT

Create or replace document with specific ID:

```
PUT http://localhost:8000/projects/PROJECT_ID/databases/(default)/documents/COLLECTION_ID/DOCUMENT_ID

Body: {
  "fields": {
    "name": {"stringValue": "John Doe"},
    "age": {"integerValue": "30"}
  }
}
```

**Note:** `DOCUMENT_ID` can be any URL-safe string up to 255 characters, or a valid 24-character hexadecimal MongoDB ObjectId for backward compatibility. This endpoint implements "set" behavior - it will create the document if it doesn't exist, or completely replace it if it does exist.

### DELETE - DELETE

```
DELETE http://localhost:8000/projects/PROJECT_ID/databases/(default)/documents/COLLECTION_ID/DOCUMENT_ID
```

## Query Operations

BaseBase supports Firebase/Firestore-compatible queries using the `:runQuery` endpoint with `structuredQuery` syntax.

### POST `:runQuery` - Query Documents

```
POST http://localhost:8000/projects/PROJECT_ID/databases/(default)/documents:runQuery
Authorization: Bearer JWT_TOKEN
Content-Type: application/json
```

**Request Body:**

```json
{
  "structuredQuery": {
    "from": [{"collectionId": "COLLECTION_ID"}],
    "where": {
      "fieldFilter": {
        "field": {"fieldPath": "FIELD_NAME"},
        "op": "OPERATOR",
        "value": {"TYPE": "VALUE"}
      }
    },
    "orderBy": [
      {
        "field": {"fieldPath": "FIELD_NAME"},
        "direction": "ASCENDING" | "DESCENDING"
      }
    ],
    "limit": 10
  }
}
```

### Supported Operators

| Operator                | Description                                  | Example                         |
| ----------------------- | -------------------------------------------- | ------------------------------- |
| `EQUAL`                 | Field equals value                           | `"op": "EQUAL"`                 |
| `NOT_EQUAL`             | Field does not equal value                   | `"op": "NOT_EQUAL"`             |
| `LESS_THAN`             | Field is less than value                     | `"op": "LESS_THAN"`             |
| `LESS_THAN_OR_EQUAL`    | Field is less than or equal to value         | `"op": "LESS_THAN_OR_EQUAL"`    |
| `GREATER_THAN`          | Field is greater than value                  | `"op": "GREATER_THAN"`          |
| `GREATER_THAN_OR_EQUAL` | Field is greater than or equal to value      | `"op": "GREATER_THAN_OR_EQUAL"` |
| `ARRAY_CONTAINS`        | Array field contains value                   | `"op": "ARRAY_CONTAINS"`        |
| `IN`                    | Field value is in array                      | `"op": "IN"`                    |
| `NOT_IN`                | Field value is not in array                  | `"op": "NOT_IN"`                |
| `MATCHES`               | Field text contains value (case-insensitive) | `"op": "MATCHES"`               |

### Value Types

| Type                  | Format                              | Example                       |
| --------------------- | ----------------------------------- | ----------------------------- |
| String                | `{"stringValue": "text"}`           | `{"stringValue": "John Doe"}` |
| Integer               | `{"integerValue": "123"}`           | `{"integerValue": "30"}`      |
| Double                | `{"doubleValue": "123.45"}`         | `{"doubleValue": "99.99"}`    |
| Boolean               | `{"booleanValue": true}`            | `{"booleanValue": false}`     |
| Null                  | `{"nullValue": null}`               | `{"nullValue": null}`         |
| Array (for IN/NOT_IN) | `{"arrayValue": {"values": [...]}}` | See examples below            |

### Query Examples

#### Basic Field Filter

Get documents where `age > 30`:

```json
{
  "structuredQuery": {
    "from": [{ "collectionId": "users" }],
    "where": {
      "fieldFilter": {
        "field": { "fieldPath": "age" },
        "op": "GREATER_THAN",
        "value": { "integerValue": "30" }
      }
    }
  }
}
```

#### Sorting and Limiting

Get top 10 users sorted by name:

```json
{
  "structuredQuery": {
    "from": [{ "collectionId": "users" }],
    "orderBy": [
      {
        "field": { "fieldPath": "name" },
        "direction": "ASCENDING"
      }
    ],
    "limit": 10
  }
}
```

#### IN Operator

Get documents where category is "news" or "sports":

```json
{
  "structuredQuery": {
    "from": [{ "collectionId": "articles" }],
    "where": {
      "fieldFilter": {
        "field": { "fieldPath": "category" },
        "op": "IN",
        "value": {
          "arrayValue": {
            "values": [{ "stringValue": "news" }, { "stringValue": "sports" }]
          }
        }
      }
    }
  }
}
```

#### Composite Filters (AND)

Get recent news articles from specific source:

```json
{
  "structuredQuery": {
    "from": [{ "collectionId": "newsStories" }],
    "where": {
      "compositeFilter": {
        "op": "AND",
        "filters": [
          {
            "fieldFilter": {
              "field": { "fieldPath": "sourceId" },
              "op": "EQUAL",
              "value": { "integerValue": "12345" }
            }
          },
          {
            "fieldFilter": {
              "field": { "fieldPath": "timestamp" },
              "op": "GREATER_THAN",
              "value": { "integerValue": "1700000000" }
            }
          }
        ]
      }
    },
    "orderBy": [
      {
        "field": { "fieldPath": "timestamp" },
        "direction": "DESCENDING"
      }
    ],
    "limit": 50
  }
}
```

### Response Format

The `:runQuery` endpoint returns an array of documents in Firebase format:

```json
[
  {
    "document": {
      "name": "projects/PROJECT_ID/databases/(default)/documents/COLLECTION_ID/DOC_ID",
      "fields": {
        "fieldName": { "stringValue": "value" }
      },
      "createTime": "2023-01-01T00:00:00Z",
      "updateTime": "2023-01-01T00:00:00Z"
    },
    "readTime": "2023-01-01T00:00:00Z"
  }
]
```

## Security Rules

BaseBase automatically creates security rules for each collection using Firebase Security Rules syntax. When a new collection is created, default rules are initialized that allow all operations.

### Security Rules Structure

Each collection has metadata stored in the `collections` collection with the following structure:

```json
{
  "projectName": "project_database_id",
  "collectionName": "collection_id",
  "rules": [
    {
      "match": "/documents/{document}",
      "allow": ["read", "write"],
      "condition": "auth != null"
    }
  ],
  "indexes": [
    {
      "fields": { "email": 1 },
      "options": { "unique": true }
    },
    {
      "fields": { "name": "text", "description": "text" },
      "options": { "name": "text_search_index" }
    },
    {
      "fields": { "tags": 1 },
      "options": { "sparse": true }
    }
  ],
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

### Managing Collection Metadata

#### Get Collection Metadata (Security Rules & Indexes)

```
GET http://localhost:8000/projects/PROJECT_ID/databases/(default)/documents/COLLECTION_ID/_security
Authorization: Bearer JWT_TOKEN
```

#### Update Security Rules

```
PUT http://localhost:8000/projects/PROJECT_ID/databases/(default)/documents/COLLECTION_ID/_security
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

#### Update Indexes

```
PUT http://localhost:8000/projects/PROJECT_ID/databases/(default)/documents/COLLECTION_ID/_security
Authorization: Bearer JWT_TOKEN

Body: {
  "indexes": [
    {
      "fields": { "email": 1 },
      "options": { "unique": true }
    },
    {
      "fields": { "name": "text", "description": "text" },
      "options": { "name": "text_search_index" }
    },
    {
      "fields": { "location": "2dsphere" },
      "options": { "name": "geo_index" }
    }
  ]
}
```

#### Update Both Rules and Indexes

```
PUT http://localhost:8000/PROJECT_id/COLLECTION_id/_security
Authorization: Bearer JWT_TOKEN

Body: {
  "rules": [
    {
      "match": "/documents/{document}",
      "allow": ["read", "write"],
      "condition": "auth != null"
    }
  ],
  "indexes": [
    {
      "fields": { "email": 1 },
      "options": { "unique": true }
    }
  ]
}
```

### Index Support

BaseBase supports MongoDB-like indexes that can be defined for each collection. Supported index types and options include:

#### Index Types

- **Single field**: `{ "fieldName": 1 }` (ascending) or `{ "fieldName": -1 }` (descending)
- **Compound**: `{ "field1": 1, "field2": -1 }`
- **Text search**: `{ "field1": "text", "field2": "text" }`
- **Geospatial (2dsphere)**: `{ "location": "2dsphere" }` (future support)

#### Index Options

- **unique**: `{ "unique": true }` - Ensures field values are unique
- **sparse**: `{ "sparse": true }` - Only indexes documents that contain the indexed field
- **name**: `{ "name": "custom_index_id" }` - Custom name for the index
- **background**: `{ "background": true }` - Creates index in background (future support)

#### Examples

**Unique email index:**

```json
{
  "fields": { "email": 1 },
  "options": { "unique": true }
}
```

**Text search index:**

```json
{
  "fields": { "title": "text", "content": "text" },
  "options": { "name": "search_index" }
}
```

**Sparse compound index:**

```json
{
  "fields": { "category": 1, "priority": -1 },
  "options": { "sparse": true, "name": "category_priority" }
}
```

**Note**: Indexes are currently stored as metadata but not yet automatically applied to the MongoDB collections. Index application will be implemented in a future update.

### Default Behavior

- **Empty rules array**: Allows all operations by everyone
- **Empty indexes array**: No custom indexes are defined
- **Automatic initialization**: Collection metadata (rules and indexes) is created when collections are first used
- **Firebase syntax**: Security rules are compatible with Firebase Security Rules syntax for easy migration
- **MongoDB indexes**: Index definitions follow MongoDB index syntax

**Note**: Security rules and indexes are currently stored as metadata but not yet enforced/applied. Rule enforcement and automatic index creation will be implemented in future updates.

## Project Management

### Create Project

```
POST http://localhost:8000/projects
Authorization: Bearer JWT_TOKEN

Body: {
  "name": "My Project",
  "description": "Optional description"
}
```

### List Projects

```
GET http://localhost:8000/projects
Authorization: Bearer JWT_TOKEN
```

### Regenerate API Key

```
POST http://localhost:8000/projects/PROJECT_ID/regenerate-key
Authorization: Bearer JWT_TOKEN
```

## Path Structure

The API uses Firebase-style path structure to match the Firestore REST API exactly:

- `/projects/{PROJECT_ID}/databases/(default)/documents/{COLLECTION_ID}` for collection operations
- `/projects/{PROJECT_ID}/databases/(default)/documents/{COLLECTION_ID}/{DOCUMENT_ID}` for document operations

Where:

- `PROJECT_ID` can be either the display name or database name
- `COLLECTION_ID` maps to MongoDB collection name
- `DOCUMENT_ID` maps to document `_id` field (or `_id` for backward compatibility)
- `(default)` is the literal string used by Firebase Firestore for the default database

Examples:

- `POST /projects/my-awesome-project/databases/(default)/documents/users` (display name)
- `POST /projects/my_awesome_project/databases/(default)/documents/users` (database name)
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
