import axios from "axios";
import moment from "moment";
import momentTimezone from "moment-timezone";
import puppeteer from "puppeteer";
import RSSParser from "rss-parser";
import { TaskExecutionContext } from "../types/tasks";
import { getTwilioClient, getTwilioPhoneNumber } from "../services/twilio";
import {
  getPostmarkClient,
  getPostmarkFromEmail,
  getPostmarkFromName,
} from "../services/postmark";
import { createSDKFunctions } from "../api/data-api";

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
        case "postmark":
          services.postmark = getPostmarkClient();
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

    // Create SDK functions for Firebase-style database access
    const sdkFunctions = createSDKFunctions(context.project.name);

    // Create the task from the code string
    const AsyncFunction = Object.getPrototypeOf(
      async function () {}
    ).constructor;

    // Create a secure require function that only allows whitelisted modules
    const createSecureRequire = (availableServices: Record<string, any>) => {
      return (moduleName: string): any => {
        // Map of allowed modules to their implementations
        const allowedModules: Record<string, any> = {
          axios: availableServices.axios,
          twilio: availableServices.twilio,
          postmark: availableServices.postmark,
          moment: availableServices.moment,
          "moment-timezone": availableServices.momentTimezone,
          puppeteer: availableServices.puppeteer,
          "rss-parser": availableServices.rssParser,
        };

        if (allowedModules.hasOwnProperty(moduleName)) {
          return allowedModules[moduleName];
        }

        // Throw an error for disallowed modules
        throw new Error(
          `Module '${moduleName}' is not available. Available modules: ${Object.keys(
            allowedModules
          ).join(", ")}`
        );
      };
    };

    // Firebase-style execution with secure require support and SDK functions
    const executionCode = `
      "use strict";
      
      // Create Node.js-like module environment (Firebase Functions pattern)
      const module = { exports: {} };
      const exports = module.exports;
      
      // Provide secure require function
      const require = createSecureRequire;
      
      // Execute user code (should set module.exports)
      ${taskCode}
      
      // Validate that a handler was exported
      if (typeof module.exports !== 'function') {
        throw new Error('Task must export a handler function using module.exports\\n\\n' +
          'Example:\\n' +
          'module.exports = async (params, context) => {\\n' +
          '  const { console, data, tasks, db, doc, getDoc, collection, getDocs } = context;\\n' +
          '  return { success: true };\\n' +
          '};');
      }
      
      return module.exports(params, context, axios, twilio, getTwilioPhoneNumber, postmark, getPostmarkFromEmail, getPostmarkFromName, moment, momentTimezone, puppeteer, rssParser);
    `;

    // Enhanced context with SDK functions
    const enhancedContext = {
      ...context,
      // SDK-style functions for familiar Firebase/Firestore patterns
      db: sdkFunctions.db,
      doc: sdkFunctions.doc,
      collection: sdkFunctions.collection,
      getDoc: sdkFunctions.getDoc,
      getDocs: sdkFunctions.getDocs,
      addDoc: sdkFunctions.addDoc,
      setDoc: sdkFunctions.setDoc,
      updateDoc: sdkFunctions.updateDoc,
      deleteDoc: sdkFunctions.deleteDoc,
    };

    const userTask = new AsyncFunction(
      "params",
      "context",
      "axios",
      "twilio",
      "getTwilioPhoneNumber",
      "postmark",
      "getPostmarkFromEmail",
      "getPostmarkFromName",
      "moment",
      "momentTimezone",
      "puppeteer",
      "rssParser",
      "createSecureRequire",
      executionCode
    );

    // Execute with timeout
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Task execution timeout")), 30000); // 30 second timeout
    });

    const executionPromise = userTask(
      params,
      enhancedContext,
      services.axios,
      services.twilio,
      getTwilioPhoneNumber,
      services.postmark,
      getPostmarkFromEmail,
      getPostmarkFromName,
      services.moment,
      services.momentTimezone,
      services.puppeteer,
      services.rssParser,
      createSecureRequire(services)
    );

    const result = await Promise.race([executionPromise, timeoutPromise]);
    return result;
  } catch (error) {
    console.error("Task execution error:", error);
    throw new Error(`Task execution failed: ${(error as Error).message}`);
  }
}
