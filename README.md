# basebase-server

The BaseBase Server exposes an API for simple storage and retrieval of JSON documents, and the definition, execution and scheduling of cloud tasks.

Documents are placed in Collections, and can be accessed via HTTP using structured paths and RESTful syntax. Each Collection is owned by a Project, which defines the read/write access rules for Documents in that Collection.

Tasks and Triggers are also owned by a Project.

## Authentication & Projects

Users authenticate via SMS phone verification and receive JWT tokens scoped to specific projects. Verification codes are sent via Twilio SMS to the provided phone number. Each project has a unique API key that must be securely stored and cannot be retrieved after creation.

JWT tokens contain the database name (project.name) for fast database operations without lookup overhead.

### Getting a JWT Token

To authenticate and get a JWT token, follow these steps:

#### Step 1: Request Verification Code

```
POST http://localhost:8000/v1/requestCode

Body: {
  "username": "your_username",
  "phone": "+1234567890"
}
```

This will send an SMS verification code to the provided phone number and create a user account if it doesn't exist.

#### Step 2: Verify Code and Get JWT

```
POST http://localhost:8000/v1/verifyCode

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
POST http://localhost:8000/v1/projects/PROJECT_ID/databases/(default)/documents/user_profiles

Body: {
  "fields": {
    "name": {"stringValue": "John Doe"},
    "age": {"integerValue": "30"}
  }
}
```

⚠️ **Note**: Collection names must be lowercase with underscores/hyphens only. Using `userProfiles` (camelCase) will return a 400 error.

**Note:** POST creates documents with auto-generated `_id` IDs (72-bit base64 strings). To create or replace a document with a specific ID, use the PUT endpoint instead.

### READ - GET

Get single document:

```
GET http://localhost:8000/v1/projects/PROJECT_ID/databases/(default)/documents/user_profiles/DOCUMENT_ID
```

Get collection:

```
GET http://localhost:8000/v1/projects/PROJECT_ID/databases/(default)/documents/user_profiles
```

### UPDATE - PATCH

Update specific fields:

```
PATCH http://localhost:8000/v1/projects/PROJECT_ID/databases/(default)/documents/user_profiles/DOCUMENT_ID

Body: {
  "fields": {
    "title": {"stringValue": "Updated Title"}
  }
}
```

### SET - PUT

Create or replace document with specific ID:

```
PUT http://localhost:8000/v1/projects/PROJECT_ID/databases/(default)/documents/user_profiles/DOCUMENT_ID

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
DELETE http://localhost:8000/v1/projects/PROJECT_ID/databases/(default)/documents/user_profiles/DOCUMENT_ID
```

## Query Operations

BaseBase supports Firebase/Firestore-compatible queries using the `:runQuery` endpoint with `structuredQuery` syntax.

### POST `:runQuery` - Query Documents

```
POST http://localhost:8000/v1/projects/PROJECT_ID/databases/(default)/documents:runQuery
Authorization: Bearer JWT_TOKEN
Content-Type: application/json
```

**Request Body:**

```json
{
  "structuredQuery": {
    "from": [{"collectionId": "user_profiles"}],
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
    "from": [{ "collectionId": "news_stories" }],
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
      "name": "projects/PROJECT_ID/databases/(default)/documents/user_profiles/DOC_ID",
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

## Cloud Tasks

BaseBase supports server-side Tasks that can be defined, invoked and run in the cloud via HTTP endpoints according to user-defined Triggers. Tasks are executed in a secure sandbox environment and can access external services like HTTP APIs and SMS providers.

### Task Projects

Tasks are organized by projects:

- **Your Project**: Tasks in your own project (e.g., `my_project`) - only you can access these
- **Public Project**: Shared tasks in the `public` project - anyone can access and execute these. Common utilities like `getPage` and `sendSms` are available here

### Accessing Tasks

**List tasks in your project:**

```bash
GET http://localhost:8000/v1/projects/my_project/tasks
```

**List public shared tasks:**

```bash
GET http://localhost:8000/v1/projects/public/tasks
```

**Execute a public task:**

```bash
POST http://localhost:8000/v1/projects/public/tasks/getPage:do
{
  "data": {
    "url": "https://example.com"
  }
}
```

### Invoking Tasks

Tasks are executed using POST requests to the following endpoint pattern:

```
POST http://localhost:8000/v1/projects/PROJECT_ID/tasks/TASK_NAME:do
Authorization: Bearer JWT_TOKEN
Content-Type: application/json
```

**Request Body:**

```json
{
  "data": {
    "parameter1": "value1",
    "parameter2": "value2"
  }
}
```

**Response Format:**

```json
{
  "success": true,
  "result": {
    // Task-specific response data
  },
  "taskName": "TASK_NAME",
  "executedAt": "2024-01-01T00:00:00.000Z"
}
```

### Available Tasks

#### getPage()

Retrieves the contents of a webpage using HTTP GET.

**Required Parameters:**

- `url` (string): The URL to fetch

**Example:**

```bash
curl -X POST http://localhost:8000/v1/projects/my-project/tasks/getPage:do \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "url": "https://example.com"
    }
  }'
```

**Response:**

```json
{
  "success": true,
  "result": {
    "success": true,
    "data": "<html>...</html>",
    "status": 200,
    "headers": {
      "content-type": "text/html"
    },
    "url": "https://example.com"
  },
  "functionName": "getPage",
  "executedAt": "2024-01-01T00:00:00.000Z"
}
```

#### sendSms()

Sends an SMS message using Twilio. **✅ Fully integrated and working!**

**Required Parameters:**

- `to` (string): Phone number in format +1234567890
- `message` (string): Text message content

**Setup Requirements:**
Configure these environment variables in your `.env` file:

- `TWILIO_ACCOUNT_SID`: Your Twilio Account SID
- `TWILIO_AUTH_TOKEN`: Your Twilio Auth Token
- `TWILIO_PHONE_NUMBER`: Your Twilio phone number (format: +1234567890)

**Behavior:**

- When Twilio is configured: Sends real SMS and returns Twilio message SID
- When not configured: Returns mock response (useful for development/testing)

**Example:**

```bash
curl -X POST http://localhost:8000/v1/projects/my-project/tasks/sendSms:do \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "to": "+1234567890",
      "message": "Hello from BaseBase!"
    }
  }'
```

**Response:**

```json
{
  "success": true,
  "result": {
    "success": true,
    "message": "SMS sent successfully via Twilio",
    "to": "+1234567890",
    "messageLength": 20,
    "sid": "SM1234567890abcdef1234567890abcdef",
    "timestamp": "2024-01-01T00:00:00.000Z"
  },
  "functionName": "sendSms",
  "executedAt": "2024-01-01T00:00:00.000Z"
}
```

**Test SMS Integration:**

```bash
npm run test-twilio
```

### Available NPM Packages

Cloud tasks have access to these pre-installed NPM packages:

| Package           | Purpose              | Usage Example                                |
| ----------------- | -------------------- | -------------------------------------------- |
| `axios`           | HTTP requests        | `await axios.get('https://api.example.com')` |
| `twilio`          | SMS messaging        | `await twilio.messages.create({...})`        |
| `moment`          | Date manipulation    | `moment().format('YYYY-MM-DD')`              |
| `moment-timezone` | Timezone-aware dates | `momentTimezone.tz('America/New_York')`      |
| `lodash`          | Utility functions    | `lodash.uniq([1,1,2,3])`                     |
| `puppeteer`       | Browser automation   | `await puppeteer.launch()`                   |
| `rss-parser`      | RSS/Atom parsing     | `await rssParser.parseString(xml)`           |

**Function Signature:**

```javascript
async (
  params,
  context,
  axios,
  twilio,
  getTwilioPhoneNumber,
  moment,
  momentTimezone,
  lodash,
  puppeteer,
  rssParser
) => {
  // Your function code here
};
```

**Example RSS Parser Function:**

```javascript
// Declare required services in your function
"requiredServices": ["axios", "moment", "lodash", "rss-parser"]

// Use in function code
const pageResult = await context.tasks.do('getPage', { url: rssUrl });
const feed = await rssParser.parseString(pageResult.data);
const latest = lodash.take(lodash.orderBy(feed.items, 'pubDate', 'desc'), 5);
```

**Test All Packages:**

```bash
npm run test-packages
```

### User-Defined Tasks

In addition to built-in tasks, you can create custom tasks that run on the BaseBase server. User tasks have access to the database, can execute other tasks, and support scheduled execution.

#### Creating User Tasks

```bash
curl -X POST http://localhost:8000/v1/projects/PROJECT_ID/tasks \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "processUserData",
    "description": "Processes user activity data and creates reports",
    "implementationCode": "async (params, context) => { const { console, data, tasks } = context; const { userId } = params; if (!userId) throw new Error(\"userId required\"); console.log(`Processing data for user: ${userId}`); const activities = await data.collection(\"user_activities\").queryDocs({ where: [{ field: \"userId\", operator: \"==\", value: userId }], limit: 100 }); const summary = { userId, totalActivities: activities.length, lastActivity: activities[0] || null, processedAt: new Date().toISOString() }; await data.collection(\"user_reports\").addDoc(summary); return summary; }",
    "requiredServices": [],
    "enabled": true
  }'
```

#### Task Code Structure

User tasks are JavaScript async functions with the following signature:

```javascript
async (params, context) => {
  // Task implementation
  return result;
};
```

**Parameters:**

- `params`: Object containing input parameters passed to the task
- `context`: Execution context with APIs and utilities

**Context APIs:**

- `context.console`: Logging (`console.log`, `console.error`, `console.warn`)
- `context.data`: Database API (Firebase-style operations)
- `context.tasks`: Task API (execute other tasks)
- `context.user`: User information (`userId`, `projectName`)
- `context.project`: Project information (`name`)

#### Database API (context.data)

```javascript
// Get single document
const user = await data.collection("users").getDoc("user123");

// Get all documents
const allUsers = await data.collection("users").getDocs();

// Add document with auto-generated ID
const newDoc = await data.collection("users").addDoc({
  name: "John Doe",
  email: "john@example.com",
});

// Set document with specific ID
await data.collection("users").setDoc("user123", {
  name: "Jane Doe",
  email: "jane@example.com",
});

// Update document
await data.collection("users").updateDoc("user123", {
  lastLogin: new Date(),
});

// Delete document
await data.collection("users").deleteDoc("user123");

// Query documents
const results = await data.collection("users").queryDocs({
  where: [
    { field: "active", operator: "==", value: true },
    { field: "age", operator: ">", value: 18 },
  ],
  orderBy: [{ field: "name", direction: "asc" }],
  limit: 50,
});
```

#### Executing Other Tasks

```javascript
// Execute built-in task
const webpage = await tasks.do("getPage", {
  url: "https://api.example.com/data",
});

// Execute user task
const result = await tasks.do("myOtherTask", { param1: "value1" });
```

#### Scheduled Tasks

Tasks can be scheduled to run automatically using cron expressions:

```bash
curl -X POST http://localhost:8000/v1/projects/PROJECT_ID/tasks \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "dailyCleanup",
    "description": "Cleans up old temporary data daily",
    "implementationCode": "async (params, context) => { const { console, data } = context; console.log(\"Starting daily cleanup...\"); const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000); const oldRecords = await data.collection(\"temp_data\").queryDocs({ where: [{ field: \"createdAt\", operator: \"<\", value: yesterday }] }); let deleted = 0; for (const record of oldRecords) { await data.collection(\"temp_data\").deleteDoc(record.id); deleted++; } console.log(`Cleaned up ${deleted} old records`); return { deleted, cleanupDate: new Date().toISOString() }; }",
    "requiredServices": [],
    "schedule": "0 2 * * *",
    "enabled": true
  }'
```

**Supported Schedule Formats:**

- `"*/10 * * * *"` - Every 10 minutes
- `"0 */1 * * *"` - Every hour
- `"0 2 * * *"` - Daily at 2 AM
- `"0 9 * * 1"` - Every Monday at 9 AM

#### Task Management

**List All Tasks (Built-in + User):**

```bash
curl http://localhost:8000/v1/projects/PROJECT_ID/tasks \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Get Task Details:**

```bash
curl http://localhost:8000/v1/projects/PROJECT_ID/tasks/TASK_NAME \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Create Task (with specific ID):**

```bash
curl -X POST http://localhost:8000/v1/projects/PROJECT_ID/tasks \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "myTask",
    "description": "My custom task",
    "implementationCode": "async (params, context) => { return { result: \"Hello World\" }; }",
    "schedule": "0 */2 * * *",
    "enabled": true
  }'
```

**Create/Update Task (Upsert):**

```bash
curl -X PUT http://localhost:8000/v1/projects/PROJECT_ID/tasks/TASK_NAME \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Updated description",
    "implementationCode": "async (params, context) => { return { updated: true }; }",
    "schedule": "0 */2 * * *",
    "enabled": false
  }'
```

> **Note:** PUT now works as an upsert operation - it will create the task if it doesn't exist, or update it if it does (similar to document PUT operations). For new tasks, `description` and `implementationCode` are required.

**Delete Task:**

```bash
curl -X DELETE http://localhost:8000/v1/projects/PROJECT_ID/tasks/TASK_NAME \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

#### Task Examples

**RSS Feed Processor:**

```javascript
async (params, context) => {
  const { console, data, tasks } = context;

  // Get news sources that need updating
  const sources = await data.collection("news_sources").queryDocs({
    where: [
      {
        field: "lastUpdated",
        operator: "<",
        value: new Date(Date.now() - 10 * 60 * 1000),
      },
    ],
    limit: 10,
  });

  let processed = 0;
  for (const source of sources) {
    try {
      // Fetch RSS feed
      const response = await tasks.do("getPage", { url: source.rssUrl });

      if (response.success) {
        // Parse and store articles (simplified)
        const articles = parseRSS(response.data);
        for (const article of articles) {
          await data.collection("articles").addDoc({
            title: article.title,
            url: article.url,
            sourceId: source.id,
            publishedAt: new Date(article.pubDate || Date.now()),
          });
        }

        // Update source timestamp
        await data.collection("news_sources").updateDoc(source.id, {
          lastUpdated: new Date(),
          articlesCount: (source.articlesCount || 0) + articles.length,
        });

        processed++;
      }
    } catch (error) {
      console.error(`Failed to process source ${source.name}:`, error.message);
    }
  }

  return { processed, total: sources.length };
};
```

**Data Analytics Function:**

```javascript
async (params, context) => {
  const { console, data } = context;
  const { timeRange = "24h" } = params;

  const hours = timeRange === "7d" ? 24 * 7 : 24;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  // Get recent user activities
  const activities = await data.collection("user_activities").queryDocs({
    where: [{ field: "timestamp", operator: ">=", value: since }],
  });

  // Analyze data
  const analytics = {
    totalActivities: activities.length,
    uniqueUsers: new Set(activities.map((a) => a.userId)).size,
    topActions: {},
    timeRange,
    generatedAt: new Date().toISOString(),
  };

  // Count action types
  activities.forEach((activity) => {
    analytics.topActions[activity.action] =
      (analytics.topActions[activity.action] || 0) + 1;
  });

  // Store analytics report
  await data.collection("analytics_reports").addDoc(analytics);

  return analytics;
};
```

### Security & Access Control

- **Authentication Required**: All task operations require a valid JWT token
- **Project Scoped**: Tasks can only be executed within the authenticated user's own project
- **Timeout Protection**: Tasks have a 30-second execution timeout
- **Sandbox Environment**: Tasks execute in a controlled environment with access only to approved services

### Error Handling

Functions return structured error responses when execution fails:

```json
{
  "error": "Function execution failed",
  "details": "Parameter 'url' is required and must be a string",
  "functionName": "getPage",
  "suggestion": "Check the function parameters and try again."
}
```

## Triggers

Triggers automatically execute tasks in response to events like schedules, database changes, or HTTP requests. They provide automation capabilities for your BaseBase applications.

### Creating Triggers

Create triggers using either auto-generated or user-specified IDs:

#### **Auto-Generated ID (Recommended)**

```
POST http://localhost:8000/v1/projects/PROJECT_ID/triggers
Authorization: Bearer JWT_TOKEN
Content-Type: application/json
```

#### **User-Specified ID**

```
PUT http://localhost:8000/v1/projects/PROJECT_ID/triggers/YOUR_TRIGGER_ID
Authorization: Bearer JWT_TOKEN
Content-Type: application/json
```

### Request Body Format

**Required Fields:**

- `taskId` (string): The ID of the task to execute
  - For project tasks: `"my-task-id"`
  - For global tasks: `"basebase/sendSms"` or `"basebase/getPage"`
- `triggerType` (string): Type of trigger - `"cron"`, `"onCreate"`, `"onUpdate"`, `"onDelete"`, `"onWrite"`, or `"http"`
- `config` (object): Configuration specific to the trigger type

**Optional Fields:**

- `taskParams` (object): Parameters to pass to the task when triggered (default: `{}`)
- `enabled` (boolean): Whether the trigger is active (default: `true`)
- `description` (string): Human-readable description

### Trigger Types & Examples

#### 1. Cron Triggers (Scheduled Tasks)

Execute tasks on a schedule using cron expressions:

```json
{
  "taskId": "daily-cleanup",
  "triggerType": "cron",
  "config": {
    "schedule": "0 2 * * *",
    "timezone": "UTC"
  },
  "taskParams": {
    "maxAge": 30,
    "batchSize": 1000,
    "notifyEmail": "admin@example.com"
  },
  "enabled": true,
  "description": "Daily cleanup at 2 AM UTC with custom parameters"
}
```

**Common Schedule Examples:**

BaseBase uses the [cron-parser](https://www.npmjs.com/package/cron-parser) library, supporting full cron expression syntax:

- `"* * * * *"` - Every minute
- `"*/5 * * * *"` - Every 5 minutes
- `"0 */2 * * *"` - Every 2 hours
- `"0 9 * * 1"` - Every Monday at 9 AM
- `"30 14 1 * *"` - 1st day of month at 2:30 PM
- `"0 0 * * 0"` - Every Sunday at midnight
- `"15 10 * * 1-5"` - Weekdays at 10:15 AM

**Cron Expression Format:**

```
*    *    *    *    *
┬    ┬    ┬    ┬    ┬
│    │    │    │    └─ day of week (0-7, 0 or 7 is Sun)
│    │    │    └────── month (1-12, JAN-DEC)
│    │    └─────────── day of month (1-31)
│    └──────────────── hour (0-23)
└───────────────────── minute (0-59)
```

**Using Global Tasks:**

```json
{
  "taskId": "basebase/sendSms",
  "triggerType": "cron",
  "config": {
    "schedule": "0 9 * * 1",
    "timezone": "UTC"
  },
  "taskParams": {
    "to": "+1234567890",
    "message": "Weekly reminder: Check your tasks!"
  },
  "enabled": true,
  "description": "Weekly SMS reminder every Monday at 9 AM"
}
```

#### 2. Database Triggers

Execute tasks when documents are created, updated, or deleted:

**onCreate Trigger:**

```json
{
  "taskId": "welcome-new-user",
  "triggerType": "onCreate",
  "config": {
    "collection": "users",
    "document": "users/{userId}"
  },
  "enabled": true,
  "description": "Send welcome email when user registers"
}
```

**onUpdate Trigger:**

```json
{
  "taskId": "sync-profile-changes",
  "triggerType": "onUpdate",
  "config": {
    "collection": "user_profiles",
    "document": "user_profiles/{profileId}"
  },
  "enabled": true,
  "description": "Sync profile changes to external services"
}
```

**onDelete Trigger:**

```json
{
  "taskId": "cleanup-user-data",
  "triggerType": "onDelete",
  "config": {
    "collection": "users"
  },
  "enabled": true,
  "description": "Clean up related data when user is deleted"
}
```

#### 3. HTTP Triggers (Webhooks)

Create webhook endpoints that execute tasks when called:

```json
{
  "taskId": "process-webhook",
  "triggerType": "http",
  "config": {
    "method": "POST",
    "path": "/webhook/stripe-payment"
  },
  "enabled": true,
  "description": "Process Stripe payment webhooks"
}
```

**Generated Webhook URL:**

```
POST http://localhost:8000/v1/projects/PROJECT_ID/webhooks/stripe-payment
```

### Managing Triggers

**List All Triggers:**

```bash
curl http://localhost:8000/v1/projects/PROJECT_ID/triggers \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Get Specific Trigger:**

```bash
curl http://localhost:8000/v1/projects/PROJECT_ID/triggers/TRIGGER_ID \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Update Trigger (Partial):**

```bash
curl -X PATCH http://localhost:8000/v1/projects/PROJECT_ID/triggers/TRIGGER_ID \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": false,
    "description": "Disabled for maintenance"
  }'
```

**Replace Trigger (Full):**

```bash
curl -X PUT http://localhost:8000/v1/projects/PROJECT_ID/triggers/TRIGGER_ID \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "new-task",
    "triggerType": "cron",
    "config": {
      "schedule": "0 3 * * *",
      "timezone": "UTC"
    },
    "enabled": true
  }'
```

**Delete Trigger:**

```bash
curl -X DELETE http://localhost:8000/v1/projects/PROJECT_ID/triggers/TRIGGER_ID \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Response Format

**Successful Creation:**

```json
{
  "_id": "trigger_abc123",
  "taskId": "daily-cleanup",
  "triggerType": "cron",
  "config": {
    "schedule": "0 2 * * *",
    "timezone": "UTC"
  },
  "enabled": true,
  "description": "Daily cleanup at 2 AM UTC",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z",
  "createdBy": "user_123"
}
```

### Error Responses

**Missing Required Fields:**

```json
{
  "error": "taskId is required"
}
```

**Invalid Trigger Configuration:**

```json
{
  "error": "Invalid cron schedule: '* * * *' - must have 6 fields"
}
```

**Task Not Found:**

```json
{
  "error": "Task not found"
}
```

### Best Practices

1. **Use Descriptive Names**: Add clear descriptions to help team members understand trigger purposes
2. **Test Schedules**: Verify cron expressions work as expected before enabling
3. **Monitor Execution**: Check task logs to ensure triggers execute successfully
4. **Resource Management**: Avoid overly frequent schedules that could impact performance
5. **Error Handling**: Ensure triggered tasks have proper error handling and logging

## Security Rules

BaseBase automatically creates security rules for each collection using Firebase Security Rules syntax. When a new collection is created, default rules are initialized that allow all operations.

### Security Rules Structure

Each collection has metadata stored in the `collections` collection with the following structure:

```json
{
  "projectName": "project_database_id",
  "collectionName": "user_profiles",
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
GET http://localhost:8000/v1/projects/PROJECT_ID/databases/(default)/documents/user_profiles/_security
Authorization: Bearer JWT_TOKEN
```

#### Update Security Rules

```
PUT http://localhost:8000/v1/projects/PROJECT_ID/databases/(default)/documents/COLLECTION_ID/_security
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
PUT http://localhost:8000/v1/projects/PROJECT_ID/databases/(default)/documents/user_profiles/_security
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
PUT http://localhost:8000/v1/projects/PROJECT_ID/databases/(default)/documents/user_profiles/_security
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
POST http://localhost:8000/v1/projects
Authorization: Bearer JWT_TOKEN

Body: {
  "name": "My Project",
  "description": "Optional description"
}
```

### List Projects

```
GET http://localhost:8000/v1/projects
Authorization: Bearer JWT_TOKEN
```

### Regenerate API Key

```
POST http://localhost:8000/v1/projects/PROJECT_ID/regenerate-key
Authorization: Bearer JWT_TOKEN
```

## Collection Naming Convention

⚠️ **Important**: Collection names must follow the `lowercase_with_underscores` convention:

- ✅ **Valid**: `users`, `user_profiles`, `order-items`, `api_keys`
- ❌ **Invalid**: `userProfiles`, `OrderItems`, `ApiKeys`, `Users`

This ensures:

- Clean, readable URLs
- Consistency with database conventions
- Compatibility with web standards

The API will **reject requests** with collection names containing uppercase letters or camelCase.

## Path Structure

The API uses Firebase-style path structure to match the Firestore REST API exactly:

- `/v1/projects/{PROJECT_ID}/databases/(default)/documents/{COLLECTION_ID}` for collection operations
- `/v1/projects/{PROJECT_ID}/databases/(default)/documents/{COLLECTION_ID}/{DOCUMENT_ID}` for document operations

Where:

- `PROJECT_ID` can be either the display name or database name
- `COLLECTION_ID` maps to MongoDB collection name (must be lowercase_with_underscores)
- `DOCUMENT_ID` maps to document `_id` field (or `_id` for backward compatibility)
- `(default)` is the literal string used by Firebase Firestore for the default database

Examples:

- `POST /v1/projects/my-awesome-project/databases/(default)/documents/users` (display name)
- `POST /v1/projects/my_awesome_project/databases/(default)/documents/users` (database name)
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
