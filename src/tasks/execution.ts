import axios from "axios";
import moment from "moment";
import momentTimezone from "moment-timezone";
import puppeteer from "puppeteer";
import RSSParser from "rss-parser";
import { TaskExecutionContext } from "../types/tasks";
import { getTwilioClient, getTwilioPhoneNumber } from "../services/twilio";

// Helper function to execute cloud task code safely
export async function executeCloudTask(
  taskCode: string,
  params: Record<string, any>,
  context: TaskExecutionContext,
  requiredServices: string[]
): Promise<any> {
  try {
    // Create execution sandbox with available services
    const services: Record<string, any> = {};

    // Add requested services
    for (const service of requiredServices) {
      switch (service) {
        case "axios":
          services.axios = axios;
          break;
        case "twilio":
          services.twilio = getTwilioClient();
          break;
        case "moment":
          services.moment = moment;
          break;
        case "moment-timezone":
          services.momentTimezone = momentTimezone;
          break;
        case "puppeteer":
          services.puppeteer = puppeteer;
          break;
        case "rss-parser":
          services.rssParser = new RSSParser();
          break;
        default:
          console.warn(`Unknown service requested: ${service}`);
      }
    }

    // Create the task from the code string
    const AsyncFunction = Object.getPrototypeOf(
      async function () {}
    ).constructor;
    const userTask = new AsyncFunction(
      "params",
      "context",
      "axios",
      "twilio",
      "getTwilioPhoneNumber",
      "moment",
      "momentTimezone",
      "puppeteer",
      "rssParser",
      `
        "use strict";
        return (${taskCode})(params, context);
      `
    );

    // Execute with timeout
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Task execution timeout")), 30000); // 30 second timeout
    });

    const executionPromise = userTask(
      params,
      context,
      services.axios,
      services.twilio,
      getTwilioPhoneNumber,
      services.moment,
      services.momentTimezone,
      services.puppeteer,
      services.rssParser
    );

    const result = await Promise.race([executionPromise, timeoutPromise]);
    return result;
  } catch (error) {
    console.error("Task execution error:", error);
    throw new Error(`Task execution failed: ${(error as Error).message}`);
  }
}
