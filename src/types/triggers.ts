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
  functionId: string;
  triggerType: TriggerType;
  config: TriggerConfig;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string; // User ID
  description?: string;
}

// API Request/Response types
export interface CreateTriggerRequest {
  functionId: string;
  triggerType: TriggerType;
  config: TriggerConfig;
  enabled?: boolean;
  description?: string;
}

export interface UpdateTriggerRequest {
  functionId?: string;
  triggerType?: TriggerType;
  config?: Partial<TriggerConfig>;
  enabled?: boolean;
  description?: string;
}

export interface TriggerResponse {
  _id: string;
  functionId: string;
  triggerType: TriggerType;
  config: TriggerConfig;
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
  functionId: string;
  triggerId: string; // New field linking to trigger
  cronExpression: string;
  nextRun: Date;
  lastRun?: Date;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}
