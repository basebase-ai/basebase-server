import {
  TriggerType,
  TriggerConfig,
  CronTriggerConfig,
  DatabaseTriggerConfig,
  HttpTriggerConfig,
} from "../types/triggers";

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateTriggerConfig(
  triggerType: TriggerType,
  config: any
): ValidationResult {
  switch (triggerType) {
    case "cron":
      return validateCronConfig(config);
    case "onCreate":
    case "onUpdate":
    case "onDelete":
    case "onWrite":
      return validateDatabaseConfig(config);
    case "http":
      return validateHttpConfig(config);
    default:
      return {
        valid: false,
        error: `Unknown trigger type: ${triggerType}`,
      };
  }
}

function validateCronConfig(config: any): ValidationResult {
  const cronConfig = config as CronTriggerConfig;

  if (!cronConfig.schedule) {
    return {
      valid: false,
      error: "Cron trigger requires 'schedule' field",
    };
  }

  if (typeof cronConfig.schedule !== "string") {
    return {
      valid: false,
      error: "Cron schedule must be a string",
    };
  }

  // Basic cron validation - check if it has 5 or 6 parts
  const cronParts = cronConfig.schedule.trim().split(/\s+/);
  if (cronParts.length !== 5 && cronParts.length !== 6) {
    return {
      valid: false,
      error:
        "Cron expression must have 5 or 6 parts (minute hour day month weekday [year])",
    };
  }

  // Validate timezone if provided
  if (cronConfig.timezone && typeof cronConfig.timezone !== "string") {
    return {
      valid: false,
      error: "Timezone must be a string",
    };
  }

  return { valid: true };
}

function validateDatabaseConfig(config: any): ValidationResult {
  const dbConfig = config as DatabaseTriggerConfig;

  if (!dbConfig.collection) {
    return {
      valid: false,
      error: "Database trigger requires 'collection' field",
    };
  }

  if (typeof dbConfig.collection !== "string") {
    return {
      valid: false,
      error: "Collection name must be a string",
    };
  }

  // Collection name validation (lowercase, underscores)
  if (!/^[a-z][a-z0-9_]*$/.test(dbConfig.collection)) {
    return {
      valid: false,
      error:
        "Collection name must be lowercase and can only contain letters, numbers, and underscores",
    };
  }

  // Validate document pattern if provided
  if (dbConfig.document) {
    if (typeof dbConfig.document !== "string") {
      return {
        valid: false,
        error: "Document pattern must be a string",
      };
    }

    // Basic document pattern validation
    if (!dbConfig.document.includes("/")) {
      return {
        valid: false,
        error:
          "Document pattern must include collection and document path (e.g., 'users/{userId}')",
      };
    }
  }

  return { valid: true };
}

function validateHttpConfig(config: any): ValidationResult {
  const httpConfig = config as HttpTriggerConfig;

  if (!httpConfig.method) {
    return {
      valid: false,
      error: "HTTP trigger requires 'method' field",
    };
  }

  const validMethods = ["GET", "POST", "PUT", "DELETE"];
  if (!validMethods.includes(httpConfig.method)) {
    return {
      valid: false,
      error: `HTTP method must be one of: ${validMethods.join(", ")}`,
    };
  }

  if (!httpConfig.path) {
    return {
      valid: false,
      error: "HTTP trigger requires 'path' field",
    };
  }

  if (typeof httpConfig.path !== "string") {
    return {
      valid: false,
      error: "HTTP path must be a string",
    };
  }

  // Path validation
  if (!httpConfig.path.startsWith("/")) {
    return {
      valid: false,
      error: "HTTP path must start with '/'",
    };
  }

  return { valid: true };
}
