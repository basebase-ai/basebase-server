# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BaseBase Server is a Node.js/Express API for rapid, scalable storage and retrieval of JSON documents. It provides a Firebase-like REST API with MongoDB as the backend, featuring SMS-based authentication via Twilio and project-based data isolation.

## Core Architecture

- **server.js**: Main Express application with CRUD endpoints and MongoDB connection management
- **auth.js**: JWT authentication, SMS verification via Twilio, and project management
- **scripts/**: Utility scripts for project setup, token generation, and testing

### Key Components

- **Authentication Flow**: SMS verification → JWT token scoped to specific projects
- **Project Isolation**: Each project gets its own MongoDB database with sanitized naming
- **Document Identity**: Uses `_id` field for document IDs (72-bit base64 strings or user-specified URL-safe strings <24 chars)
- **Backward Compatibility**: Still supports MongoDB ObjectId queries for existing documents
- **Data Format**: Firestore-compatible field structure (`{"fields": {"name": {"stringValue": "value"}}}`)
- **Security Rules**: Firebase-style rules stored as metadata (not yet enforced)
- **Indexing**: MongoDB index definitions stored as collection metadata

## Development Commands

### Server Management

```bash
npm start                    # Start production server
npm run dev                  # Start with nodemon for development
```

### Utility Scripts

```bash
npm run setup                # Create test project and configuration
npm run get-token           # Interactive JWT token generation
npm run create-project      # Interactive project creation
npm run manage-security-rules # Manage collection security rules and indexes
npm run test-index-application # Test index functionality
```

### Environment Setup

Required `.env` variables:

- `MONGODB_URI`: MongoDB Atlas connection string
- `PORT`: Server port (default: 8000)
- `JWT_SECRET`: Secret for JWT token signing
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`: SMS verification

## API Structure

### Authentication Endpoints (No JWT required)

- `POST /requestCode` - Request SMS verification code
- `POST /verifyCode` - Verify code and get JWT token

### Project Management (JWT required)

- `POST /projects` - Create new project
- `GET /projects` - List user's projects
- `POST /projects/:id/regenerate-key` - Regenerate project API key

### Document CRUD (JWT required)

- `POST /:project/:collection` - Create document (auto-generated \_id)
- `PUT /:project/:collection/:docId` - Create/replace document with specific \_id
- `GET /:project/:collection/:docId` - Read single document (by \_id or ObjectId for backward compatibility)
- `GET /:project/:collection` - Read all documents in collection
- `PATCH /:project/:collection/:docId` - Update specific fields (cannot modify \_id)
- `DELETE /:project/:collection/:docId` - Delete document

### Collection Metadata (JWT required)

- `GET /:project/:collection/_security` - Get security rules and indexes
- `PUT /:project/:collection/_security` - Update security rules and/or indexes

## Database Structure

### Internal Collections (basebase database)

- `users` - User accounts with phone verification
- `projects` - Project configurations with API keys
- `verification_codes` - Temporary SMS codes
- `collections` - Collection metadata (security rules, indexes)

### Project Databases

Each project gets its own database with sanitized name (lowercase, underscores for special chars).

## Code Conventions

- Use existing MongoDB helper functions in server.js
- Follow Firestore field format for document structure
- Document IDs use `_id` field (auto-generated 72-bit base64 or user-specified URL-safe strings)
- Maintain backward compatibility with MongoDB ObjectId for existing documents
- Project names are automatically sanitized for MongoDB compatibility
- JWT tokens include database name for performance optimization
- The `_id` field is immutable after creation (cannot be changed via PATCH)
- All API endpoints require proper error handling and status codes

## Testing

Health check endpoint: `GET /health`

Use the utility scripts for interactive testing and setup rather than writing custom test files.
