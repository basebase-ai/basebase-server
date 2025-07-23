// Trigger system related interfaces

export type TriggerType =
  | "cron"
  | "onCreate"
  | "onUpdate"
  | "onDelete"
  | "onWrite"
  | "http";

export interface BaseTriggerConfig {
  [key: string]: any;
}

export interface CronTriggerConfig extends BaseTriggerConfig {
  schedule: string; // Cron expression
  timezone?: string; // Default: UTC
}

export interface DatabaseTriggerConfig extends BaseTriggerConfig {
  collection: string; // Collection name
  document?: string; // Document path pattern (e.g., "users/{userId}")
}

export interface HttpTriggerConfig extends BaseTriggerConfig {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string; // Endpoint path
}

export type TriggerConfig =
  | CronTriggerConfig
  | DatabaseTriggerConfig
  | HttpTriggerConfig;

export interface Trigger {
  _id: string;
  taskId: string;
  triggerType: TriggerType;
  config: TriggerConfig;
  taskParams?: Record<string, any>; // Parameters to pass to the task when triggered
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string; // User ID
  description?: string;
}

// API Request/Response types
export interface CreateTriggerRequest {
  taskId: string;
  triggerType: TriggerType;
  config: TriggerConfig;
  taskParams?: Record<string, any>; // Parameters to pass to the task when triggered
  enabled?: boolean;
  description?: string;
}

export interface UpdateTriggerRequest {
  taskId?: string;
  triggerType?: TriggerType;
  config?: Partial<TriggerConfig>;
  taskParams?: Record<string, any>;
  enabled?: boolean;
  description?: string;
}

export interface TriggerResponse {
  _id: string;
  taskId: string;
  triggerType: TriggerType;
  config: TriggerConfig;
  taskParams?: Record<string, any>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  description?: string;
}

export interface ListTriggersResponse {
  triggers: TriggerResponse[];
  total: number;
}

// For scheduler compatibility
export interface ScheduledJob {
  _id: string;
  projectId: string;
  taskId: string;
  triggerId: string; // New field linking to trigger
  cronExpression: string;
  nextRun: Date;
  lastRun?: Date;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}
