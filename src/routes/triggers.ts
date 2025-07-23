import { Router, Response } from "express";
import { ObjectId } from "mongodb";
import {
  AuthenticatedRequest,
  Trigger,
  CreateTriggerRequest,
  UpdateTriggerRequest,
  TriggerResponse,
  ListTriggersResponse,
  CronTriggerConfig,
  DatabaseTriggerConfig,
} from "../types";
import {
  getProjectTriggersCollection,
  getProjectTasksCollection,
} from "../database/collections";
import { validateTriggerConfig } from "../utils/trigger-validation";

const router = Router();

// GET /v1/projects/:projectId/triggers - List all triggers
router.get(
  "/v1/projects/:projectId/triggers",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { projectId } = req.params;
      const triggersCollection = getProjectTriggersCollection(projectId);

      const triggers = await triggersCollection.find({}).toArray();

      const response: ListTriggersResponse = {
        triggers: triggers.map(triggerToResponse),
        total: triggers.length,
      };

      res.json(response);
    } catch (error) {
      console.error("Error listing triggers:", error);
      res.status(500).json({ error: "Failed to list triggers" });
    }
  }
);

// GET /v1/projects/:projectId/triggers/:triggerId - Get specific trigger
router.get(
  "/v1/projects/:projectId/triggers/:triggerId",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { projectId, triggerId } = req.params;
      const triggersCollection = getProjectTriggersCollection(projectId);

      const trigger = await triggersCollection.findOne({ _id: triggerId });

      if (!trigger) {
        return res.status(404).json({ error: "Trigger not found" });
      }

      res.json(triggerToResponse(trigger));
    } catch (error) {
      console.error("Error getting trigger:", error);
      res.status(500).json({ error: "Failed to get trigger" });
    }
  }
);

// POST /v1/projects/:projectId/triggers - Create new trigger
router.post(
  "/v1/projects/:projectId/triggers",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { projectId } = req.params;
      const triggerData: CreateTriggerRequest = req.body;

      // Validate required fields
      if (!triggerData.taskId) {
        return res.status(400).json({ error: "taskId is required" });
      }

      if (!triggerData.triggerType) {
        return res.status(400).json({ error: "triggerType is required" });
      }

      if (!triggerData.config) {
        return res.status(400).json({ error: "config is required" });
      }

      // Validate trigger config
      const configValidation = validateTriggerConfig(
        triggerData.triggerType,
        triggerData.config
      );
      if (!configValidation.valid) {
        return res.status(400).json({ error: configValidation.error });
      }

      // Check if task exists
      const tasksCollection = getProjectTasksCollection(projectId);
      const taskExists = await tasksCollection.findOne({
        _id: triggerData.taskId,
      });

      if (!taskExists) {
        return res.status(404).json({ error: "Task not found" });
      }

      // Create trigger
      const triggersCollection = getProjectTriggersCollection(projectId);
      const now = new Date();
      const trigger: Trigger = {
        _id: new ObjectId().toString(),
        taskId: triggerData.taskId,
        triggerType: triggerData.triggerType,
        config: triggerData.config,
        taskParams: triggerData.taskParams,
        enabled: triggerData.enabled ?? true,
        description: triggerData.description,
        createdAt: now,
        updatedAt: now,
        createdBy: req.user?.userId,
      };

      await triggersCollection.insertOne(trigger);

      res.status(201).json(triggerToResponse(trigger));
    } catch (error) {
      console.error("Error creating trigger:", error);
      res.status(500).json({ error: "Failed to create trigger" });
    }
  }
);

// PUT /v1/projects/:projectId/triggers/:triggerId - Update trigger
router.put(
  "/v1/projects/:projectId/triggers/:triggerId",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { projectId, triggerId } = req.params;
      const updates: UpdateTriggerRequest = req.body;
      const triggersCollection = getProjectTriggersCollection(projectId);

      // Check if trigger exists
      const existingTrigger = await triggersCollection.findOne({
        _id: triggerId,
      });

      if (!existingTrigger) {
        return res.status(404).json({ error: "Trigger not found" });
      }

      // Validate trigger config if being updated
      if (updates.triggerType && updates.config) {
        const configValidation = validateTriggerConfig(
          updates.triggerType,
          updates.config
        );
        if (!configValidation.valid) {
          return res.status(400).json({ error: configValidation.error });
        }
      }

      // Check if task exists if being updated
      if (updates.taskId) {
        const tasksCollection = getProjectTasksCollection(projectId);
        const taskExists = await tasksCollection.findOne({
          _id: updates.taskId,
        });

        if (!taskExists) {
          return res.status(404).json({ error: "Task not found" });
        }
      }

      // Update trigger
      const updateDoc: any = {
        ...updates,
        updatedAt: new Date(),
      };

      // Remove undefined fields
      Object.keys(updateDoc).forEach((key) => {
        if (updateDoc[key] === undefined) {
          delete updateDoc[key];
        }
      });

      await triggersCollection.updateOne(
        { _id: triggerId },
        { $set: updateDoc }
      );

      // Get updated trigger
      const updatedTrigger = await triggersCollection.findOne({
        _id: triggerId,
      });

      res.json(triggerToResponse(updatedTrigger!));
    } catch (error) {
      console.error("Error updating trigger:", error);
      res.status(500).json({ error: "Failed to update trigger" });
    }
  }
);

// DELETE /v1/projects/:projectId/triggers/:triggerId - Delete trigger
router.delete(
  "/v1/projects/:projectId/triggers/:triggerId",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { projectId, triggerId } = req.params;
      const triggersCollection = getProjectTriggersCollection(projectId);

      const result = await triggersCollection.deleteOne({ _id: triggerId });

      if (result.deletedCount === 0) {
        return res.status(404).json({ error: "Trigger not found" });
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting trigger:", error);
      res.status(500).json({ error: "Failed to delete trigger" });
    }
  }
);

// Helper function to convert Trigger to TriggerResponse
function triggerToResponse(trigger: Trigger): TriggerResponse {
  return {
    _id: trigger._id,
    taskId: trigger.taskId,
    triggerType: trigger.triggerType,
    config: trigger.config,
    taskParams: trigger.taskParams,
    enabled: trigger.enabled,
    createdAt: trigger.createdAt.toISOString(),
    updatedAt: trigger.updatedAt.toISOString(),
    createdBy: trigger.createdBy,
    description: trigger.description,
  };
}

export default router;
