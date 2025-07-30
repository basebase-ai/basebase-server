# Infrastructure Creation

This document describes the infrastructure creation system that automatically sets up GitHub repositories and Railway deployments for new BaseBase projects.

## Overview

The infrastructure creation system is split into focused endpoints for better debugging and testing:

### **Individual Endpoints**

1. **`POST /v1/create-project`** - Create project document in database
2. **`POST /v1/create-repo`** - Fork GitHub repository and update config
3. **`POST /v1/create-service`** - Create Railway service, trigger deployment, and set up custom domain

## Process Flow

When creating complete infrastructure, the system will:

1. **Create Project Document** - Store project details in the database
2. **Fork GitHub Repository** - Fork `basebase-ai/nextjs-starter` to `basebase-ai/{project-id}`
3. **Update Config** - Modify `config.ts` and `README.md` with project-specific details
4. **Create Railway Service** - Create a service within existing Railway project
5. **Trigger Deployment** - Deploy the service from the GitHub repository
6. **Set Up Custom Domain** - Configure `{project-id}.basebase.ai` subdomain

## Required Environment Variables

Add these to your `.env` file:

```bash
# Railway Integration
RAILWAY_API_TOKEN=your-railway-api-token
RAILWAY_TEAM_ID=your-railway-team-id-optional

# GitHub Integration
GITHUB_TOKEN=your-github-personal-access-token
GITHUB_OWNER=basebase-ai
```

### Getting Railway API Token

1. Visit [Railway Account Settings](https://railway.app/account/tokens)
2. Create a new **Account Token** (or Team Token if using teams)
3. Copy the token to your `.env` file

### Getting GitHub Token

1. Visit [GitHub Personal Access Tokens](https://github.com/settings/tokens)
2. Create a **Fine-grained personal access token**
3. Grant permissions to the `basebase-ai` organization
4. Required permissions:
   - Repository: Read, Write, Administration
   - Contents: Read, Write
   - Metadata: Read

## API Endpoints

### 1. Create Project Document

**`POST /v1/create-project`**

Creates only the project document in the database.

**Request Body:**

```json
{
  "projectId": "my-app",
  "name": "My App",
  "description": "A cool new app",
  "categories": ["web", "saas"]
}
```

**Response:**

```json
{
  "success": true,
  "project": {
    "id": "my-app",
    "name": "My App",
    "description": "A cool new app",
    "categories": ["web", "saas"],
    "githubUrl": "https://github.com/basebase-ai/my-app",
    "productionUrl": "https://my-app.basebase.ai/",
    "apiKey": "bbs_abc123..."
  }
}
```

### 2. Create GitHub Repository

**`POST /v1/create-repo`**

Forks the starter template and updates config. Requires project to exist in database. Uses GitHub token from environment variables.

**Request Body:**

```json
{
  "projectId": "my-app"
}
```

**Response:**

```json
{
  "success": true,
  "repository": {
    "name": "my-app",
    "fullName": "basebase-ai/my-app",
    "url": "https://github.com/basebase-ai/my-app",
    "cloneUrl": "https://github.com/basebase-ai/my-app.git",
    "defaultBranch": "master"
  }
}
```

### 3. Create Railway Service

**`POST /v1/create-service`**

Creates Railway service, triggers deployment, and sets up custom domain. Requires project to exist in database.

**Request Body:**

```json
{
  "projectId": "my-app"
}
```

**Response:**

```json
{
  "success": true,
  "service": {
    "id": "service-id",
    "name": "my-app",
    "projectId": "73e34391-e6de-4970-8f25-afb3d56e1846",
    "environmentId": "env-id",
    "deploymentId": "deployment-id",
    "domain": "my-app.basebase.ai",
    "deploymentUrl": "https://my-app.basebase.ai/"
  }
}
```

## Testing

### Test Individual Components

```bash
# Test database operations only
npm run test-create-project

# Test GitHub operations only
npm run test-create-repo

# Test Railway operations only
npm run test-create-service
```

### Test Environment Setup

```bash
# Validate environment variables and API connectivity
npm run test-infrastructure-config
```

## Domain Configuration

Ensure you have:

- Wildcard DNS record: `*.basebase.ai` → Railway
- Railway custom domain support configured
- SSL certificate provisioning enabled

## Rate Limits

Be aware of API rate limits:

- **Railway**: 1000 requests/hour, 10-50 RPS
- **GitHub**: 5000 requests/hour for authenticated requests

## Monitoring

Monitor the infrastructure creation process through:

- Application logs (`[PROJECT]`, `[REPO]`, `[SERVICE]` prefixes)
- Railway deployment logs
- GitHub webhook events (if configured)
