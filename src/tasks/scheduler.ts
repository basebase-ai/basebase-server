import { getMongoClient } from "../database/connection";
import {
  getProjectTasksCollection,
  getProjectTriggersCollection,
} from "../database/collections";
import { CloudTask, TaskExecutionContext } from "../types/tasks";
import { Trigger, CronTriggerConfig } from "../types/triggers";
import { ProjectDataAPI } from "../api/data-api";
import { ProjectTaskAPI } from "../api/tasks-api";
import { FunctionConsoleAPI } from "../api/console-api";
import { executeCloudTask } from "./execution";
import { CronExpressionParser } from "cron-parser";

// Simple cron expression parser for basic scheduling
export class SimpleScheduler {
  private static instance: SimpleScheduler;
  private intervalId: NodeJS.Timeout | null = null;

  static getInstance(): SimpleScheduler {
    if (!SimpleScheduler.instance) {
      SimpleScheduler.instance = new SimpleScheduler();
    }
    return SimpleScheduler.instance;
  }

  start(): void {
    if (this.intervalId) {
      return; // Already running
    }

    console.log("[SCHEDULER] Starting task scheduler...");

    // Check every minute for tasks to run
    this.intervalId = setInterval(async () => {
      await this.checkScheduledTasks();
    }, 60000); // 60 seconds
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log("[SCHEDULER] Stopped task scheduler");
    }
  }

  private async checkScheduledTasks(): Promise<void> {
    try {
      const now = new Date();
      console.log(
        `[SCHEDULER] Checking scheduled triggers at ${now.toISOString()}`
      );

      const mongoClient = getMongoClient();

      // Get all projects that have cron triggers
      const adminDb = mongoClient.db().admin();
      const databases = await adminDb.listDatabases();

      for (const dbInfo of databases.databases) {
        if (
          dbInfo.name === "admin" ||
          dbInfo.name === "local" ||
          dbInfo.name === "config" ||
          dbInfo.name === "basebase"
        ) {
          continue; // Skip system databases
        }

        try {
          const projectTriggersCollection = getProjectTriggersCollection(
            dbInfo.name
          );
          const cronTriggers = await projectTriggersCollection
            .find({
              triggerType: "cron",
              enabled: { $ne: false },
            })
            .toArray();

          for (const trigger of cronTriggers) {
            const cronConfig = trigger.config as CronTriggerConfig;
            if (
              this.shouldRunTask(cronConfig.schedule, now, cronConfig.timezone)
            ) {
              console.log(
                `[SCHEDULER] Executing cron trigger: ${trigger._id} for task ${trigger.taskId} in project ${dbInfo.name}`
              );

              // Execute task in background
              setImmediate(async () => {
                try {
                  await this.executeTriggeredTask(dbInfo.name, trigger);
                } catch (error) {
                  console.error(
                    `[SCHEDULER] Error executing triggered task ${trigger.taskId}:`,
                    error
                  );
                }
              });
            }
          }
        } catch (error) {
          console.error(
            `[SCHEDULER] Error checking triggers in project ${dbInfo.name}:`,
            error
          );
        }
      }
    } catch (error) {
      console.error("[SCHEDULER] Error in scheduler:", error);
    }
  }

  private shouldRunTask(
    schedule: string,
    now: Date,
    timezone?: string
  ): boolean {
    try {
      // Parse the cron expression with timezone support
      const options: any = {
        currentDate: now,
      };

      if (timezone) {
        options.tz = timezone;
      }

      // Parse the cron expression
      const interval = CronExpressionParser.parse(schedule, options);

      // Get the previous execution time
      const prevTime = interval.prev();

      // Check if the previous execution time was within the last minute
      // This means the task should run now
      const timeDiff = now.getTime() - prevTime.toDate().getTime();

      // Run if the last execution time was within the last 60 seconds
      return timeDiff >= 0 && timeDiff < 60000;
    } catch (error) {
      console.error(
        `[SCHEDULER] Error parsing cron expression "${schedule}":`,
        error
      );
      return false;
    }
  }

  private async executeTriggeredTask(
    projectName: string,
    trigger: Trigger
  ): Promise<void> {
    try {
      // Get the task to execute (support both public and project tasks)
      let task;
      let actualTaskId = trigger.taskId;

      if (trigger.taskId.startsWith("public/")) {
        // Public task - check in public project tasks collection
        actualTaskId = trigger.taskId.replace("public/", "");
        const publicTasksCollection = getProjectTasksCollection("public");
        task = await publicTasksCollection.findOne({
          _id: actualTaskId,
        });
      } else {
        // Project task - check in project tasks collection
        const projectTasksCollection = getProjectTasksCollection(projectName);
        task = await projectTasksCollection.findOne({
          _id: trigger.taskId,
        });
      }

      if (!task) {
        console.error(
          `[SCHEDULER] Task ${trigger.taskId} not found for trigger ${trigger._id}`
        );
        return;
      }

      // Create execution context for triggered task
      const consoleAPI = new FunctionConsoleAPI();
      const dataAPI = new ProjectDataAPI(projectName);

      const partialContext: Partial<TaskExecutionContext> = {
        user: {
          userId: trigger.createdBy || "system",
          projectName: projectName,
        },
        project: {
          name: projectName,
        },
        data: dataAPI,
        console: consoleAPI,
      };

      const tasksAPI = new ProjectTaskAPI(
        projectName,
        partialContext as TaskExecutionContext
      );
      const executionContext: TaskExecutionContext = {
        ...partialContext,
        tasks: tasksAPI,
      } as TaskExecutionContext;

      // Execute the task with trigger parameters
      const result = await executeCloudTask(
        task.implementationCode,
        trigger.taskParams || {}, // Use trigger parameters or empty object
        executionContext,
        task.requiredServices
      );

      console.log(
        `[SCHEDULER] Successfully executed triggered task ${task._id} via trigger ${trigger._id}:`,
        result
      );
    } catch (error) {
      console.error(
        `[SCHEDULER] Failed to execute triggered task ${trigger.taskId} via trigger ${trigger._id}:`,
        error
      );
    }
  }
}
