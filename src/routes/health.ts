import { Request, Response, Router } from "express";

const router = Router();

// Health check endpoint
router.get("/health", (req: Request, res: Response) => {
  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  });
});

// Helper function to provide route suggestions
function getRouteSuggestion(method: string, path: string): string {
  const pathParts = path.split("/").filter((part) => part);

  if (
    method === "POST" &&
    pathParts.length === 6 &&
    pathParts[0] === "projects" &&
    pathParts[2] === "databases" &&
    pathParts[4] === "documents"
  ) {
    return `To create a document in collection '${pathParts[5]}' of project '${pathParts[1]}' with auto-generated _id, use: POST /v1/projects/${pathParts[1]}/databases/(default)/documents/${pathParts[5]}`;
  } else if (
    method === "GET" &&
    pathParts.length === 7 &&
    pathParts[0] === "projects" &&
    pathParts[2] === "databases" &&
    pathParts[4] === "documents"
  ) {
    return `To get document '${pathParts[6]}' from collection '${pathParts[5]}' of project '${pathParts[1]}', use: GET /v1/projects/${pathParts[1]}/databases/(default)/documents/${pathParts[5]}/${pathParts[6]}`;
  } else if (
    method === "GET" &&
    pathParts.length === 6 &&
    pathParts[0] === "projects" &&
    pathParts[2] === "databases" &&
    pathParts[4] === "documents"
  ) {
    return `To get all documents from collection '${pathParts[5]}' of project '${pathParts[1]}', use: GET /v1/projects/${pathParts[1]}/databases/(default)/documents/${pathParts[5]}`;
  } else if (
    method === "PUT" &&
    pathParts.length === 7 &&
    pathParts[0] === "projects" &&
    pathParts[2] === "databases" &&
    pathParts[4] === "documents"
  ) {
    return `To set (create or replace) document '${pathParts[6]}' in collection '${pathParts[5]}' of project '${pathParts[1]}', use: PUT /v1/projects/${pathParts[1]}/databases/(default)/documents/${pathParts[5]}/${pathParts[6]} (ID must be URL-safe, ≤255 chars)`;
  }

  return `Check the available routes listed above for the correct Firebase-style API endpoint format.`;
}

// 404 handler with helpful suggestions
export function create404Handler() {
  return (req: Request, res: Response) => {
    console.log(`[404] ${req.method} ${req.path} - Route not found`);
    console.log(`[404] Available routes for data operations:`);
    console.log(
      `  POST /v1/projects/[projectId]/databases/(default)/documents/[collectionId] - Create document (auto-generated _id)`
    );
    console.log(
      `  GET /v1/projects/[projectId]/databases/(default)/documents/[collectionId] - Get all documents`
    );
    console.log(
      `  GET /v1/projects/[projectId]/databases/(default)/documents/[collectionId]/[documentId] - Get specific document`
    );
    console.log(
      `  PATCH /v1/projects/[projectId]/databases/(default)/documents/[collectionId]/[documentId] - Update document`
    );
    console.log(
      `  PUT /v1/projects/[projectId]/databases/(default)/documents/[collectionId]/[documentId] - Set document (create or replace with specific _id)`
    );
    console.log(
      `  DELETE /v1/projects/[projectId]/databases/(default)/documents/[collectionId]/[documentId] - Delete document`
    );
    console.log(
      `  GET /v1/projects/[projectId]/databases/(default)/documents/[collectionId]/_security - Get collection metadata`
    );
    console.log(
      `  PUT /v1/projects/[projectId]/databases/(default)/documents/[collectionId]/_security - Update collection metadata`
    );
    console.log(`[404] Available routes for server functions:`);
    console.log(`  GET /v1/functions - List all server functions`);
    console.log(
      `  GET /v1/functions/[functionName] - Get specific function details`
    );
    console.log(
      `  POST /v1/projects/[projectId]/functions/[functionName]:call - Call server function`
    );

    res.status(404).json({
      error: "Route not found",
      method: req.method,
      path: req.path,
      suggestion: getRouteSuggestion(req.method, req.path),
      availableRoutes: {
        create:
          "POST /v1/projects/:projectId/databases/(default)/documents/:collectionId (auto-generated _id)",
        read: "GET /v1/projects/:projectId/databases/(default)/documents/:collectionId or GET /v1/projects/:projectId/databases/(default)/documents/:collectionId/:documentId",
        update:
          "PATCH /v1/projects/:projectId/databases/(default)/documents/:collectionId/:documentId",
        set: "PUT /v1/projects/:projectId/databases/(default)/documents/:collectionId/:documentId (create or replace with specific _id)",
        delete:
          "DELETE /v1/projects/:projectId/databases/(default)/documents/:collectionId/:documentId",
        metadata:
          "GET/PUT /v1/projects/:projectId/databases/(default)/documents/:collectionId/_security",
        auth: "POST /v1/requestCode, POST /v1/verifyCode",
        projects: "GET /v1/projects, POST /v1/projects",
        functions:
          "GET /v1/functions, GET /v1/functions/:functionName, POST /v1/projects/:projectId/functions/:functionName:call",
      },
    });
  };
}

export default router;
