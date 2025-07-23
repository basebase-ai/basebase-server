import { Router, Response } from "express";
import { AuthenticatedRequest } from "../types";
import { ServerFunction, FunctionExecutionContext } from "../types/functions";
import { FunctionCallRequest } from "../types/api";
import {
  getServerFunctionsCollection,
  getProjectFunctionsCollection,
} from "../database/collections";
import { resolveProjectDatabaseName } from "../database/validation";
import { isValidName } from "../database/validation";
import { ProjectDataAPI } from "../api/data-api";
import { ProjectFunctionAPI } from "../api/functions-api";
import { FunctionConsoleAPI } from "../api/console-api";
import { executeServerFunction } from "../functions/execution";

const router = Router();

// LIST ALL FUNCTIONS (GLOBAL + PROJECT) - GET
router.get(
  "/v1/projects/:projectId/functions",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { projectId } = req.params;

      console.log(`[FUNCTION] GET /v1/projects/${projectId}/functions`);
      console.log(
        `[FUNCTION] User: ${req.user!.userId}, Project: ${
          req.user!.projectName
        }`
      );

      // Resolve the requested project name to database name
      let targetDbName: string;
      try {
        targetDbName = await resolveProjectDatabaseName(projectId);
      } catch (resolveError) {
        console.error(`[FUNCTION] Project resolution failed:`, resolveError);
        return res.status(404).json({
          error: (resolveError as Error).message,
          suggestion: `Make sure the project '${projectId}' exists and you have access to it.`,
        });
      }

      // Check if user has access to the project
      if (req.user!.projectName !== targetDbName) {
        console.error(
          `[FUNCTION] Access denied: User project ${
            req.user!.projectName
          } does not match target ${targetDbName}`
        );
        return res.status(403).json({
          error: "Access denied",
          suggestion: `You can only access functions in your own project '${
            req.user!.projectName
          }'.`,
        });
      }

      // Get global basebase functions
      const globalFunctionsCollection = getServerFunctionsCollection();
      const globalFunctions = await globalFunctionsCollection
        .find({}, { projection: { implementationCode: 0 } })
        .toArray();

      // Get project-specific functions
      const projectFunctionsCollection =
        getProjectFunctionsCollection(targetDbName);
      const projectFunctions = await projectFunctionsCollection
        .find({}, { projection: { implementationCode: 0 } })
        .toArray();

      const allFunctions = [
        ...globalFunctions.map((func) => ({
          id: func._id,
          description: func.description,
          requiredServices: func.requiredServices,
          createdAt: func.createdAt,
          updatedAt: func.updatedAt,
          isUserFunction: false,
          enabled: func.enabled !== false,
        })),
        ...projectFunctions.map((func) => ({
          id: func._id,
          description: func.description,
          requiredServices: func.requiredServices,
          createdAt: func.createdAt,
          updatedAt: func.updatedAt,
          isUserFunction: true,
          enabled: func.enabled !== false,
          createdBy: func.createdBy,
        })),
      ];

      console.log(
        `[FUNCTION] Found ${globalFunctions.length} global + ${projectFunctions.length} project functions`
      );

      res.json({
        functions: allFunctions,
        count: allFunctions.length,
        globalCount: globalFunctions.length,
        projectCount: projectFunctions.length,
      });
    } catch (error) {
      console.error(`[FUNCTION] Error listing functions:`, error);
      res.status(500).json({
        error: "Failed to list functions",
        suggestion: "Contact support if the problem persists.",
      });
    }
  }
);

// GET SPECIFIC FUNCTION - GET (checks both global and project functions)
router.get(
  "/v1/projects/:projectId/functions/:functionName",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { projectId, functionName } = req.params;

      console.log(
        `[FUNCTION] GET /v1/projects/${projectId}/functions/${functionName}`
      );
      console.log(
        `[FUNCTION] User: ${req.user!.userId}, Project: ${
          req.user!.projectName
        }`
      );

      // Resolve the requested project name to database name
      let targetDbName: string;
      try {
        targetDbName = await resolveProjectDatabaseName(projectId);
      } catch (resolveError) {
        console.error(`[FUNCTION] Project resolution failed:`, resolveError);
        return res.status(404).json({
          error: (resolveError as Error).message,
          suggestion: `Make sure the project '${projectId}' exists and you have access to it.`,
        });
      }

      // Check if user has access to the project
      if (req.user!.projectName !== targetDbName) {
        console.error(
          `[FUNCTION] Access denied: User project ${
            req.user!.projectName
          } does not match target ${targetDbName}`
        );
        return res.status(403).json({
          error: "Access denied",
          suggestion: `You can only access functions in your own project '${
            req.user!.projectName
          }'.`,
        });
      }

      // First try project functions
      const projectFunctionsCollection =
        getProjectFunctionsCollection(targetDbName);
      let serverFunction = await projectFunctionsCollection.findOne({
        _id: functionName,
      });

      let isUserFunction = true;

      // If not found, try global functions
      if (!serverFunction) {
        const globalFunctionsCollection = getServerFunctionsCollection();
        serverFunction = await globalFunctionsCollection.findOne({
          _id: functionName,
        });
        isUserFunction = false;
      }

      if (!serverFunction) {
        console.log(`[FUNCTION] Function not found: ${functionName}`);
        return res.status(404).json({
          error: "Function not found",
          suggestion: `The function '${functionName}' does not exist.`,
        });
      }

      console.log(`[FUNCTION] Retrieved function ${functionName}`);

      res.json({
        id: serverFunction._id,
        description: serverFunction.description,
        implementationCode: serverFunction.implementationCode,
        requiredServices: serverFunction.requiredServices,
        createdAt: serverFunction.createdAt,
        updatedAt: serverFunction.updatedAt,
        isUserFunction,
        enabled: serverFunction.enabled !== false,
        createdBy: serverFunction.createdBy,
      });
    } catch (error) {
      console.error(`[FUNCTION] Error getting function:`, error);
      res.status(500).json({
        error: "Failed to get function",
        suggestion: "Contact support if the problem persists.",
      });
    }
  }
);

// CREATE USER FUNCTION - POST
router.post(
  "/v1/projects/:projectId/functions",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { projectId } = req.params;
      const { id, description, implementationCode, requiredServices, enabled } =
        req.body;

      if (!id || !description || !implementationCode) {
        return res.status(400).json({
          error: "Missing required fields",
          suggestion:
            "Function must have 'id', 'description', and 'implementationCode' fields.",
        });
      }

      if (!isValidName(id)) {
        return res.status(400).json({
          error: "Invalid function ID",
          suggestion:
            "Function ID must be URL-safe, up to 255 characters, and contain only letters, numbers, hyphens, and underscores.",
        });
      }

      console.log(
        `[FUNCTION] POST /v1/projects/${projectId}/functions - Creating function ${id}`
      );
      console.log(
        `[FUNCTION] User: ${req.user!.userId}, Project: ${
          req.user!.projectName
        }`
      );

      // Resolve the requested project name to database name
      let targetDbName: string;
      try {
        targetDbName = await resolveProjectDatabaseName(projectId);
      } catch (resolveError) {
        console.error(`[FUNCTION] Project resolution failed:`, resolveError);
        return res.status(404).json({
          error: (resolveError as Error).message,
          suggestion: `Make sure the project '${projectId}' exists and you have access to it.`,
        });
      }

      // Check if user has access to the project
      if (req.user!.projectName !== targetDbName) {
        console.error(
          `[FUNCTION] Access denied: User project ${
            req.user!.projectName
          } does not match target ${targetDbName}`
        );
        return res.status(403).json({
          error: "Access denied",
          suggestion: `You can only create functions in your own project '${
            req.user!.projectName
          }'.`,
        });
      }

      const projectFunctionsCollection =
        getProjectFunctionsCollection(targetDbName);

      // Check if function already exists
      const existingFunction = await projectFunctionsCollection.findOne({
        _id: id,
      });
      if (existingFunction) {
        return res.status(409).json({
          error: "Function already exists",
          suggestion: `A function with ID '${id}' already exists. Use PUT to update it.`,
        });
      }

      const now = new Date();
      const newFunction: ServerFunction = {
        _id: id,
        description,
        implementationCode,
        requiredServices: requiredServices || [],
        enabled: enabled !== false,
        createdBy: req.user!.userId,
        isUserFunction: true,
        createdAt: now,
        updatedAt: now,
      };

      await projectFunctionsCollection.insertOne(newFunction);

      console.log(
        `[FUNCTION] Created user function ${id} in project ${targetDbName}`
      );

      res.status(201).json({
        id: newFunction._id,
        description: newFunction.description,
        requiredServices: newFunction.requiredServices,
        enabled: newFunction.enabled,
        isUserFunction: true,
        createdBy: newFunction.createdBy,
        createdAt: newFunction.createdAt,
        updatedAt: newFunction.updatedAt,
      });
    } catch (error) {
      console.error(`[FUNCTION] Error creating function:`, error);
      res.status(500).json({
        error: "Failed to create function",
        suggestion:
          "Check your function data and try again. Contact support if the problem persists.",
      });
    }
  }
);

// UPDATE USER FUNCTION - PUT
router.put(
  "/v1/projects/:projectId/functions/:functionName",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { projectId, functionName } = req.params;
      const { description, implementationCode, requiredServices, enabled } =
        req.body;

      console.log(
        `[FUNCTION] PUT /v1/projects/${projectId}/functions/${functionName}`
      );
      console.log(
        `[FUNCTION] User: ${req.user!.userId}, Project: ${
          req.user!.projectName
        }`
      );

      // Resolve the requested project name to database name
      let targetDbName: string;
      try {
        targetDbName = await resolveProjectDatabaseName(projectId);
      } catch (resolveError) {
        console.error(`[FUNCTION] Project resolution failed:`, resolveError);
        return res.status(404).json({
          error: (resolveError as Error).message,
          suggestion: `Make sure the project '${projectId}' exists and you have access to it.`,
        });
      }

      // Check if user has access to the project
      if (req.user!.projectName !== targetDbName) {
        console.error(
          `[FUNCTION] Access denied: User project ${
            req.user!.projectName
          } does not match target ${targetDbName}`
        );
        return res.status(403).json({
          error: "Access denied",
          suggestion: `You can only update functions in your own project '${
            req.user!.projectName
          }'.`,
        });
      }

      const projectFunctionsCollection =
        getProjectFunctionsCollection(targetDbName);

      // Check if function exists and belongs to user
      const existingFunction = await projectFunctionsCollection.findOne({
        _id: functionName,
      });
      if (!existingFunction) {
        return res.status(404).json({
          error: "Function not found",
          suggestion: `Function '${functionName}' does not exist in your project.`,
        });
      }

      const updateData: Partial<ServerFunction> = {
        updatedAt: new Date(),
      };

      if (description !== undefined) updateData.description = description;
      if (implementationCode !== undefined)
        updateData.implementationCode = implementationCode;
      if (requiredServices !== undefined)
        updateData.requiredServices = requiredServices;
      if (enabled !== undefined) updateData.enabled = enabled;

      await projectFunctionsCollection.updateOne(
        { _id: functionName },
        { $set: updateData }
      );

      const updatedFunction = await projectFunctionsCollection.findOne({
        _id: functionName,
      });

      console.log(`[FUNCTION] Updated user function ${functionName}`);

      res.json({
        id: updatedFunction!._id,
        description: updatedFunction!.description,
        implementationCode: updatedFunction!.implementationCode,
        requiredServices: updatedFunction!.requiredServices,
        enabled: updatedFunction!.enabled,
        isUserFunction: true,
        createdBy: updatedFunction!.createdBy,
        createdAt: updatedFunction!.createdAt,
        updatedAt: updatedFunction!.updatedAt,
      });
    } catch (error) {
      console.error(`[FUNCTION] Error updating function:`, error);
      res.status(500).json({
        error: "Failed to update function",
        suggestion:
          "Check your function data and try again. Contact support if the problem persists.",
      });
    }
  }
);

// DELETE USER FUNCTION - DELETE
router.delete(
  "/v1/projects/:projectId/functions/:functionName",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { projectId, functionName } = req.params;

      console.log(
        `[FUNCTION] DELETE /v1/projects/${projectId}/functions/${functionName}`
      );
      console.log(
        `[FUNCTION] User: ${req.user!.userId}, Project: ${
          req.user!.projectName
        }`
      );

      // Resolve the requested project name to database name
      let targetDbName: string;
      try {
        targetDbName = await resolveProjectDatabaseName(projectId);
      } catch (resolveError) {
        console.error(`[FUNCTION] Project resolution failed:`, resolveError);
        return res.status(404).json({
          error: (resolveError as Error).message,
          suggestion: `Make sure the project '${projectId}' exists and you have access to it.`,
        });
      }

      // Check if user has access to the project
      if (req.user!.projectName !== targetDbName) {
        console.error(
          `[FUNCTION] Access denied: User project ${
            req.user!.projectName
          } does not match target ${targetDbName}`
        );
        return res.status(403).json({
          error: "Access denied",
          suggestion: `You can only delete functions in your own project '${
            req.user!.projectName
          }'.`,
        });
      }

      const projectFunctionsCollection =
        getProjectFunctionsCollection(targetDbName);

      const result = await projectFunctionsCollection.deleteOne({
        _id: functionName,
      });

      if (result.deletedCount === 0) {
        return res.status(404).json({
          error: "Function not found",
          suggestion: `Function '${functionName}' does not exist in your project.`,
        });
      }

      console.log(`[FUNCTION] Deleted user function ${functionName}`);

      res.json({
        message: "Function deleted successfully",
        functionName,
      });
    } catch (error) {
      console.error(`[FUNCTION] Error deleting function:`, error);
      res.status(500).json({
        error: "Failed to delete function",
        suggestion: "Contact support if the problem persists.",
      });
    }
  }
);

// CALL SERVER FUNCTION - POST (Firebase pattern with :call)
router.post(
  /^\/v1\/projects\/([^\/]+)\/functions\/([^\/]+):call$/,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Extract projectId and functionName from regex match
      const match = req.path.match(
        /^\/v1\/projects\/([^\/]+)\/functions\/([^\/]+):call$/
      );
      if (!match) {
        return res.status(400).json({
          error: "Invalid route format",
          suggestion:
            "Use format: /v1/projects/{projectId}/functions/{functionName}:call",
        });
      }

      const projectId = match[1];
      const functionName = match[2];

      // Validate JSON body structure
      if (!req.body || typeof req.body !== "object") {
        return res.status(400).json({
          error: "Invalid request format",
          suggestion:
            "Request body must be valid JSON with optional 'data' field",
        });
      }

      const { data } = req.body as FunctionCallRequest;

      console.log(
        `[FUNCTION] POST /v1/projects/${projectId}/functions/${functionName}:call`
      );
      console.log(
        `[FUNCTION] User: ${req.user!.userId}, Project: ${
          req.user!.projectName
        }`
      );
      console.log(`[FUNCTION] Function: ${functionName}, Data:`, data);

      // Resolve the requested project name to database name
      let targetDbName: string;
      try {
        targetDbName = await resolveProjectDatabaseName(projectId);
      } catch (resolveError) {
        console.error(`[FUNCTION] Project resolution failed:`, resolveError);
        return res.status(404).json({
          error: (resolveError as Error).message,
          suggestion: `Make sure the project '${projectId}' exists and you have access to it.`,
        });
      }

      // Check if user has access to the project
      if (req.user!.projectName !== targetDbName) {
        console.error(
          `[FUNCTION] Access denied: User project ${
            req.user!.projectName
          } does not match target ${targetDbName}`
        );
        return res.status(403).json({
          error: "Access denied",
          suggestion: `You can only call functions in your own project '${
            req.user!.projectName
          }'.`,
        });
      }

      // Get the server function from the database (try project first, then global)
      const projectFunctionsCollection =
        getProjectFunctionsCollection(targetDbName);
      let serverFunction = await projectFunctionsCollection.findOne({
        _id: functionName,
      });

      // If not found in project, try global functions
      if (!serverFunction) {
        const globalFunctionsCollection = getServerFunctionsCollection();
        serverFunction = await globalFunctionsCollection.findOne({
          _id: functionName,
        });
      }

      if (!serverFunction) {
        console.log(`[FUNCTION] Function not found: ${functionName}`);
        return res.status(404).json({
          error: "Function not found",
          suggestion: `The function '${functionName}' does not exist. Available functions can be found by calling GET /v1/projects/{projectId}/functions.`,
        });
      }

      // Prepare execution context
      const consoleAPI = new FunctionConsoleAPI();
      const dataAPI = new ProjectDataAPI(targetDbName);

      // Create a partial context first to avoid circular reference
      const partialContext: Partial<FunctionExecutionContext> = {
        user: {
          userId: req.user!.userId,
          projectName: req.user!.projectName,
        },
        project: {
          name: targetDbName,
        },
        data: dataAPI,
        console: consoleAPI,
      };

      // Now create the full context with functions API
      const functionsAPI = new ProjectFunctionAPI(
        targetDbName,
        partialContext as FunctionExecutionContext
      );
      const executionContext: FunctionExecutionContext = {
        ...partialContext,
        functions: functionsAPI,
      } as FunctionExecutionContext;

      console.log(`[FUNCTION] Executing function ${functionName}`);

      // Execute the function
      try {
        const result = await executeServerFunction(
          serverFunction.implementationCode,
          data || {},
          executionContext,
          serverFunction.requiredServices
        );

        console.log(
          `[FUNCTION] Function ${functionName} executed successfully`
        );

        res.json({
          success: true,
          result: result,
          functionName: functionName,
          executedAt: new Date().toISOString(),
        });
      } catch (executionError) {
        console.error(
          `[FUNCTION] Function execution failed for ${functionName}:`,
          executionError
        );
        return res.status(500).json({
          error: "Function execution failed",
          details: (executionError as Error).message,
          functionName: functionName,
          suggestion:
            "Check the function parameters and try again. Contact support if the problem persists.",
        });
      }
    } catch (error) {
      console.error(`[FUNCTION] Error calling function:`, error);
      res.status(500).json({
        error: "Failed to call function",
        suggestion:
          "Check your request format and try again. Contact support if the problem persists.",
      });
    }
  }
);

export default router;
