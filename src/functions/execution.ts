import axios from "axios";
import moment from "moment";
import momentTimezone from "moment-timezone";
import puppeteer from "puppeteer";
import RSSParser from "rss-parser";
import { FunctionExecutionContext } from "../types/functions";
import { getTwilioClient, getTwilioPhoneNumber } from "../services/twilio";

// Helper function to execute server function code safely
export async function executeServerFunction(
  functionCode: string,
  params: Record<string, any>,
  context: FunctionExecutionContext,
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

    // Create the function from the code string
    const AsyncFunction = Object.getPrototypeOf(
      async function () {}
    ).constructor;
    const userFunction = new AsyncFunction(
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
        return (${functionCode})(params, context);
      `
    );

    // Execute with timeout
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Function execution timeout")), 30000); // 30 second timeout
    });

    const executionPromise = userFunction(
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
    console.error("Function execution error:", error);
    throw new Error(`Function execution failed: ${(error as Error).message}`);
  }
}
