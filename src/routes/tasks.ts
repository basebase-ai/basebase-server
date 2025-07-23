import { Router, Response } from "express";
import { AuthenticatedRequest } from "../types";
import { CloudTask, TaskExecutionContext } from "../types/tasks";
import { TaskCallRequest } from "../types/api";
import {
  getCloudTasksCollection,
  getProjectTasksCollection,
} from "../database/collections";
import { resolveProjectDatabaseName } from "../database/validation";
import { isValidName } from "../database/validation";
import { ProjectDataAPI } from "../api/data-api";
import { ProjectTaskAPI } from "../api/tasks-api";
import { FunctionConsoleAPI } from "../api/console-api";
import { executeCloudTask } from "../tasks/execution";

const router = Router();

// LIST ALL TASKS (GLOBAL + PROJECT) - GET
router.get(
  "/v1/projects/:projectId/tasks",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { projectId } = req.params;

      console.log(`[TASK] GET /v1/projects/${projectId}/tasks`);
      console.log(
        `[TASK] User: ${req.user!.userId}, Project: ${req.user!.projectName}`
      );

      // Resolve the requested project name to database name
      let targetDbName: string;
      try {
        targetDbName = await resolveProjectDatabaseName(projectId);
      } catch (resolveError) {
        console.error(`[TASK] Project resolution failed:`, resolveError);
        return res.status(404).json({
          error: (resolveError as Error).message,
          suggestion: `Make sure the project '${projectId}' exists and you have access to it.`,
        });
      }

      // Check if user has access to the project
      if (req.user!.projectName !== targetDbName) {
        console.error(
          `[TASK] Access denied: User project ${
            req.user!.projectName
          } does not match target ${targetDbName}`
        );
        return res.status(403).json({
          error: "Access denied",
          suggestion: `You can only access tasks in your own project '${
            req.user!.projectName
          }'.`,
        });
      }

      // Get global basebase tasks
      const globalTasksCollection = getCloudTasksCollection();
      const globalTasks = await globalTasksCollection
        .find({}, { projection: { implementationCode: 0 } })
        .toArray();

      // Get project-specific tasks
      const projectTasksCollection = getProjectTasksCollection(targetDbName);
      const projectTasks = await projectTasksCollection
        .find({}, { projection: { implementationCode: 0 } })
        .toArray();

      const allTasks = [
        ...globalTasks.map((task) => ({
          id: task._id,
          description: task.description,
          requiredServices: task.requiredServices,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
          isUserTask: false,
          enabled: task.enabled !== false,
        })),
        ...projectTasks.map((task) => ({
          id: task._id,
          description: task.description,
          requiredServices: task.requiredServices,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
          isUserTask: true,
          enabled: task.enabled !== false,
          createdBy: task.createdBy,
        })),
      ];

      console.log(
        `[TASK] Found ${globalTasks.length} global + ${projectTasks.length} project tasks`
      );

      res.json({
        tasks: allTasks,
        count: allTasks.length,
        globalCount: globalTasks.length,
        projectCount: projectTasks.length,
      });
    } catch (error) {
      console.error(`[TASK] Error listing tasks:`, error);
      res.status(500).json({
        error: "Failed to list tasks",
        suggestion: "Contact support if the problem persists.",
      });
    }
  }
);

// GET SPECIFIC TASK - GET (checks both global and project tasks)
router.get(
  "/v1/projects/:projectId/tasks/:taskName",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { projectId, taskName } = req.params;

      console.log(`[TASK] GET /v1/projects/${projectId}/tasks/${taskName}`);
      console.log(
        `[TASK] User: ${req.user!.userId}, Project: ${req.user!.projectName}`
      );

      // Resolve the requested project name to database name
      let targetDbName: string;
      try {
        targetDbName = await resolveProjectDatabaseName(projectId);
      } catch (resolveError) {
        console.error(`[TASK] Project resolution failed:`, resolveError);
        return res.status(404).json({
          error: (resolveError as Error).message,
          suggestion: `Make sure the project '${projectId}' exists and you have access to it.`,
        });
      }

      // Check if user has access to the project
      if (req.user!.projectName !== targetDbName) {
        console.error(
          `[TASK] Access denied: User project ${
            req.user!.projectName
          } does not match target ${targetDbName}`
        );
        return res.status(403).json({
          error: "Access denied",
          suggestion: `You can only access tasks in your own project '${
            req.user!.projectName
          }'.`,
        });
      }

      // First try project tasks
      const projectTasksCollection = getProjectTasksCollection(targetDbName);
      let cloudTask = await projectTasksCollection.findOne({
        _id: taskName,
      });

      let isUserTask = true;

      // If not found, try global tasks
      if (!cloudTask) {
        const globalTasksCollection = getCloudTasksCollection();
        cloudTask = await globalTasksCollection.findOne({
          _id: taskName,
        });
        isUserTask = false;
      }

      if (!cloudTask) {
        console.log(`[TASK] Task not found: ${taskName}`);
        return res.status(404).json({
          error: "Task not found",
          suggestion: `The task '${taskName}' does not exist.`,
        });
      }

      console.log(`[TASK] Retrieved task ${taskName}`);

      res.json({
        id: cloudTask._id,
        description: cloudTask.description,
        implementationCode: cloudTask.implementationCode,
        requiredServices: cloudTask.requiredServices,
        createdAt: cloudTask.createdAt,
        updatedAt: cloudTask.updatedAt,
        isUserTask,
        enabled: cloudTask.enabled !== false,
        createdBy: cloudTask.createdBy,
      });
    } catch (error) {
      console.error(`[TASK] Error getting task:`, error);
      res.status(500).json({
        error: "Failed to get task",
        suggestion: "Contact support if the problem persists.",
      });
    }
  }
);

// CREATE USER TASK - POST
router.post(
  "/v1/projects/:projectId/tasks",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { projectId } = req.params;
      const { id, description, implementationCode, requiredServices, enabled } =
        req.body;

      if (!id || !description || !implementationCode) {
        return res.status(400).json({
          error: "Missing required fields",
          suggestion:
            "Task must have 'id', 'description', and 'implementationCode' fields.",
        });
      }

      if (!isValidName(id)) {
        return res.status(400).json({
          error: "Invalid task ID",
          suggestion:
            "Task ID must be URL-safe, up to 255 characters, and contain only letters, numbers, hyphens, and underscores.",
        });
      }

      console.log(
        `[TASK] POST /v1/projects/${projectId}/tasks - Creating task ${id}`
      );
      console.log(
        `[TASK] User: ${req.user!.userId}, Project: ${req.user!.projectName}`
      );

      // Resolve the requested project name to database name
      let targetDbName: string;
      try {
        targetDbName = await resolveProjectDatabaseName(projectId);
      } catch (resolveError) {
        console.error(`[TASK] Project resolution failed:`, resolveError);
        return res.status(404).json({
          error: (resolveError as Error).message,
          suggestion: `Make sure the project '${projectId}' exists and you have access to it.`,
        });
      }

      // Check if user has access to the project
      if (req.user!.projectName !== targetDbName) {
        console.error(
          `[TASK] Access denied: User project ${
            req.user!.projectName
          } does not match target ${targetDbName}`
        );
        return res.status(403).json({
          error: "Access denied",
          suggestion: `You can only create tasks in your own project '${
            req.user!.projectName
          }'.`,
        });
      }

      const projectTasksCollection = getProjectTasksCollection(targetDbName);

      // Check if task already exists
      const existingTask = await projectTasksCollection.findOne({
        _id: id,
      });
      if (existingTask) {
        return res.status(409).json({
          error: "Task already exists",
          suggestion: `A task with ID '${id}' already exists. Use PUT to update it.`,
        });
      }

      const now = new Date();
      const newTask: CloudTask = {
        _id: id,
        description,
        implementationCode,
        requiredServices: requiredServices || [],
        enabled: enabled !== false,
        createdBy: req.user!.userId,
        isUserTask: true,
        createdAt: now,
        updatedAt: now,
      };

      await projectTasksCollection.insertOne(newTask);

      console.log(`[TASK] Created user task ${id} in project ${targetDbName}`);

      res.status(201).json({
        id: newTask._id,
        description: newTask.description,
        requiredServices: newTask.requiredServices,
        enabled: newTask.enabled,
        isUserTask: true,
        createdBy: newTask.createdBy,
        createdAt: newTask.createdAt,
        updatedAt: newTask.updatedAt,
      });
    } catch (error) {
      console.error(`[TASK] Error creating task:`, error);
      res.status(500).json({
        error: "Failed to create task",
        suggestion:
          "Check your task data and try again. Contact support if the problem persists.",
      });
    }
  }
);

// UPDATE USER TASK - PUT
router.put(
  "/v1/projects/:projectId/tasks/:taskName",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { projectId, taskName } = req.params;
      const { description, implementationCode, requiredServices, enabled } =
        req.body;

      console.log(`[TASK] PUT /v1/projects/${projectId}/tasks/${taskName}`);
      console.log(
        `[TASK] User: ${req.user!.userId}, Project: ${req.user!.projectName}`
      );

      // Resolve the requested project name to database name
      let targetDbName: string;
      try {
        targetDbName = await resolveProjectDatabaseName(projectId);
      } catch (resolveError) {
        console.error(`[TASK] Project resolution failed:`, resolveError);
        return res.status(404).json({
          error: (resolveError as Error).message,
          suggestion: `Make sure the project '${projectId}' exists and you have access to it.`,
        });
      }

      // Check if user has access to the project
      if (req.user!.projectName !== targetDbName) {
        console.error(
          `[TASK] Access denied: User project ${
            req.user!.projectName
          } does not match target ${targetDbName}`
        );
        return res.status(403).json({
          error: "Access denied",
          suggestion: `You can only update tasks in your own project '${
            req.user!.projectName
          }'.`,
        });
      }

      const projectTasksCollection = getProjectTasksCollection(targetDbName);

      // Check if task exists and belongs to user
      const existingTask = await projectTasksCollection.findOne({
        _id: taskName,
      });
      if (!existingTask) {
        return res.status(404).json({
          error: "Task not found",
          suggestion: `Task '${taskName}' does not exist in your project.`,
        });
      }

      const updateData: Partial<CloudTask> = {
        updatedAt: new Date(),
      };

      if (description !== undefined) updateData.description = description;
      if (implementationCode !== undefined)
        updateData.implementationCode = implementationCode;
      if (requiredServices !== undefined)
        updateData.requiredServices = requiredServices;
      if (enabled !== undefined) updateData.enabled = enabled;

      await projectTasksCollection.updateOne(
        { _id: taskName },
        { $set: updateData }
      );

      const updatedTask = await projectTasksCollection.findOne({
        _id: taskName,
      });

      console.log(`[TASK] Updated user task ${taskName}`);

      res.json({
        id: updatedTask!._id,
        description: updatedTask!.description,
        implementationCode: updatedTask!.implementationCode,
        requiredServices: updatedTask!.requiredServices,
        enabled: updatedTask!.enabled,
        isUserTask: true,
        createdBy: updatedTask!.createdBy,
        createdAt: updatedTask!.createdAt,
        updatedAt: updatedTask!.updatedAt,
      });
    } catch (error) {
      console.error(`[TASK] Error updating task:`, error);
      res.status(500).json({
        error: "Failed to update task",
        suggestion:
          "Check your task data and try again. Contact support if the problem persists.",
      });
    }
  }
);

// DELETE USER TASK - DELETE
router.delete(
  "/v1/projects/:projectId/tasks/:taskName",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { projectId, taskName } = req.params;

      console.log(`[TASK] DELETE /v1/projects/${projectId}/tasks/${taskName}`);
      console.log(
        `[TASK] User: ${req.user!.userId}, Project: ${req.user!.projectName}`
      );

      // Resolve the requested project name to database name
      let targetDbName: string;
      try {
        targetDbName = await resolveProjectDatabaseName(projectId);
      } catch (resolveError) {
        console.error(`[TASK] Project resolution failed:`, resolveError);
        return res.status(404).json({
          error: (resolveError as Error).message,
          suggestion: `Make sure the project '${projectId}' exists and you have access to it.`,
        });
      }

      // Check if user has access to the project
      if (req.user!.projectName !== targetDbName) {
        console.error(
          `[TASK] Access denied: User project ${
            req.user!.projectName
          } does not match target ${targetDbName}`
        );
        return res.status(403).json({
          error: "Access denied",
          suggestion: `You can only delete tasks in your own project '${
            req.user!.projectName
          }'.`,
        });
      }

      const projectTasksCollection = getProjectTasksCollection(targetDbName);

      const result = await projectTasksCollection.deleteOne({
        _id: taskName,
      });

      if (result.deletedCount === 0) {
        return res.status(404).json({
          error: "Task not found",
          suggestion: `Task '${taskName}' does not exist in your project.`,
        });
      }

      console.log(`[TASK] Deleted user task ${taskName}`);

      res.json({
        message: "Task deleted successfully",
        taskName,
      });
    } catch (error) {
      console.error(`[TASK] Error deleting task:`, error);
      res.status(500).json({
        error: "Failed to delete task",
        suggestion: "Contact support if the problem persists.",
      });
    }
  }
);

// CALL CLOUD TASK - POST (Firebase pattern with :call)
router.post(
  /^\/v1\/projects\/([^\/]+)\/tasks\/([^\/]+):call$/,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Extract projectId and taskName from regex match
      const match = req.path.match(
        /^\/v1\/projects\/([^\/]+)\/tasks\/([^\/]+):call$/
      );
      if (!match) {
        return res.status(400).json({
          error: "Invalid route format",
          suggestion:
            "Use format: /v1/projects/{projectId}/tasks/{taskName}:call",
        });
      }

      const projectId = match[1];
      const taskName = match[2];

      // Validate JSON body structure
      if (!req.body || typeof req.body !== "object") {
        return res.status(400).json({
          error: "Invalid request format",
          suggestion:
            "Request body must be valid JSON with optional 'data' field",
        });
      }

      const { data } = req.body as TaskCallRequest;

      console.log(
        `[TASK] POST /v1/projects/${projectId}/tasks/${taskName}:call`
      );
      console.log(
        `[TASK] User: ${req.user!.userId}, Project: ${req.user!.projectName}`
      );
      console.log(`[TASK] Task: ${taskName}, Data:`, data);

      // Resolve the requested project name to database name
      let targetDbName: string;
      try {
        targetDbName = await resolveProjectDatabaseName(projectId);
      } catch (resolveError) {
        console.error(`[TASK] Project resolution failed:`, resolveError);
        return res.status(404).json({
          error: (resolveError as Error).message,
          suggestion: `Make sure the project '${projectId}' exists and you have access to it.`,
        });
      }

      // Check if user has access to the project
      if (req.user!.projectName !== targetDbName) {
        console.error(
          `[TASK] Access denied: User project ${
            req.user!.projectName
          } does not match target ${targetDbName}`
        );
        return res.status(403).json({
          error: "Access denied",
          suggestion: `You can only call tasks in your own project '${
            req.user!.projectName
          }'.`,
        });
      }

      // Get the cloud task from the database (try project first, then global)
      const projectTasksCollection = getProjectTasksCollection(targetDbName);
      let cloudTask = await projectTasksCollection.findOne({
        _id: taskName,
      });

      // If not found in project, try global tasks
      if (!cloudTask) {
        const globalTasksCollection = getCloudTasksCollection();
        cloudTask = await globalTasksCollection.findOne({
          _id: taskName,
        });
      }

      if (!cloudTask) {
        console.log(`[TASK] Task not found: ${taskName}`);
        return res.status(404).json({
          error: "Task not found",
          suggestion: `The task '${taskName}' does not exist. Available tasks can be found by calling GET /v1/projects/{projectId}/tasks.`,
        });
      }

      // Prepare execution context
      const consoleAPI = new FunctionConsoleAPI();
      const dataAPI = new ProjectDataAPI(targetDbName);

      // Create a partial context first to avoid circular reference
      const partialContext: Partial<TaskExecutionContext> = {
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

      // Now create the full context with tasks API
      const tasksAPI = new ProjectTaskAPI(
        targetDbName,
        partialContext as TaskExecutionContext
      );
      const executionContext: TaskExecutionContext = {
        ...partialContext,
        tasks: tasksAPI,
      } as TaskExecutionContext;

      console.log(`[TASK] Executing task ${taskName}`);

      // Execute the task
      try {
        const result = await executeCloudTask(
          cloudTask.implementationCode,
          data || {},
          executionContext,
          cloudTask.requiredServices
        );

        console.log(`[TASK] Task ${taskName} executed successfully`);

        res.json({
          success: true,
          result: result,
          taskName: taskName,
          executedAt: new Date().toISOString(),
        });
      } catch (executionError) {
        console.error(
          `[TASK] Task execution failed for ${taskName}:`,
          executionError
        );
        return res.status(500).json({
          error: "Task execution failed",
          details: (executionError as Error).message,
          taskName: taskName,
          suggestion:
            "Check the task parameters and try again. Contact support if the problem persists.",
        });
      }
    } catch (error) {
      console.error(`[TASK] Error calling task:`, error);
      res.status(500).json({
        error: "Failed to call task",
        suggestion:
          "Check your request format and try again. Contact support if the problem persists.",
      });
    }
  }
);

export default router;
