import { getMongoClient } from "../database/connection";
import {
  getProjectFunctionsCollection,
  getProjectTriggersCollection,
} from "../database/collections";
import { ServerFunction, FunctionExecutionContext } from "../types/functions";
import { Trigger, CronTriggerConfig } from "../types/triggers";
import { ProjectDataAPI } from "../api/data-api";
import { ProjectFunctionAPI } from "../api/functions-api";
import { FunctionConsoleAPI } from "../api/console-api";
import { executeServerFunction } from "./execution";

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

    console.log("[SCHEDULER] Starting function scheduler...");

    // Check every minute for functions to run
    this.intervalId = setInterval(async () => {
      await this.checkScheduledFunctions();
    }, 60000); // 60 seconds
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log("[SCHEDULER] Stopped function scheduler");
    }
  }

  private async checkScheduledFunctions(): Promise<void> {
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
            if (this.shouldRunFunction(cronConfig.schedule, now)) {
              console.log(
                `[SCHEDULER] Executing cron trigger: ${trigger._id} for function ${trigger.functionId} in project ${dbInfo.name}`
              );

              // Execute function in background
              setImmediate(async () => {
                try {
                  await this.executeTriggeredFunction(dbInfo.name, trigger);
                } catch (error) {
                  console.error(
                    `[SCHEDULER] Error executing triggered function ${trigger.functionId}:`,
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

  private shouldRunFunction(schedule: string, now: Date): boolean {
    // Simple schedule parsing - support basic formats:
    // "*/10 * * * *" = every 10 minutes
    // "0 */1 * * *" = every hour
    // "0 9 * * *" = daily at 9 AM

    if (schedule === "*/10 * * * *") {
      // Every 10 minutes
      return now.getMinutes() % 10 === 0 && now.getSeconds() < 30;
    }

    if (schedule === "0 */1 * * *") {
      // Every hour
      return now.getMinutes() === 0 && now.getSeconds() < 30;
    }

    if (schedule === "0 9 * * *") {
      // Daily at 9 AM
      return (
        now.getHours() === 9 && now.getMinutes() === 0 && now.getSeconds() < 30
      );
    }

    // Add more schedule patterns as needed
    console.warn(`[SCHEDULER] Unsupported schedule format: ${schedule}`);
    return false;
  }

  private async executeTriggeredFunction(
    projectName: string,
    trigger: Trigger
  ): Promise<void> {
    try {
      // Get the function to execute
      const projectFunctionsCollection =
        getProjectFunctionsCollection(projectName);
      const func = await projectFunctionsCollection.findOne({
        _id: trigger.functionId,
      });

      if (!func) {
        console.error(
          `[SCHEDULER] Function ${trigger.functionId} not found for trigger ${trigger._id}`
        );
        return;
      }

      // Create execution context for triggered function
      const consoleAPI = new FunctionConsoleAPI();
      const dataAPI = new ProjectDataAPI(projectName);

      const partialContext: Partial<FunctionExecutionContext> = {
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

      const functionsAPI = new ProjectFunctionAPI(
        projectName,
        partialContext as FunctionExecutionContext
      );
      const executionContext: FunctionExecutionContext = {
        ...partialContext,
        functions: functionsAPI,
      } as FunctionExecutionContext;

      // Execute the function
      const result = await executeServerFunction(
        func.implementationCode,
        {}, // No parameters for scheduled execution
        executionContext,
        func.requiredServices
      );

      console.log(
        `[SCHEDULER] Successfully executed triggered function ${func._id} via trigger ${trigger._id}:`,
        result
      );
    } catch (error) {
      console.error(
        `[SCHEDULER] Failed to execute triggered function ${trigger.functionId} via trigger ${trigger._id}:`,
        error
      );
    }
  }
}
