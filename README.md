# basebase-server

The BaseBase Server exposes an API for rapid, scalable storage and retrieval of JSON documents.

Documents are placed in Collections, and can be accessed via HTTP using structured paths and RESTful syntax.
Each Collection is owned by a Project, which defines the read/write access rules for Documents in that Collection.

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

## Path Structure

The API uses a simple path structure:

- `PROJECT_NAME` maps to MongoDB database name
- `COLLECTION_NAME` maps to MongoDB collection name
- `DOCUMENT_ID` maps to MongoDB document `_id`

## Data Format

The API uses Firestore-compatible data format with "fields" wrapper and explicit data types:

- `stringValue` for strings
- `integerValue` for integers (as strings)
- `doubleValue` for floating point numbers
- `booleanValue` for booleans
- `nullValue` for null values

## Quick Start

See `SETUP.md` for detailed setup instructions.
