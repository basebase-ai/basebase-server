// Cloud task system related interfaces
import {
  DataAPI,
  CollectionAPI,
  GetDocsOptions,
  QueryFilter,
  ConsoleAPI,
} from "./functions";

export interface CloudTask {
  _id: string;
  description: string;
  implementationCode: string;
  requiredServices: string[];
  createdAt: Date;
  updatedAt: Date;
  // New fields for user tasks
  enabled?: boolean; // Whether task is active (default: true)
  createdBy?: string; // User ID (undefined for global basebase tasks)
  isUserTask?: boolean; // True for user-defined tasks
}

export interface TaskExecutionContext {
  user: {
    userId: string;
    projectName: string;
  };
  project: {
    name: string;
  };
  // Firebase-style data API
  data: DataAPI;
  // Task calling capability
  tasks: TaskAPI;
  // Console for logging
  console: ConsoleAPI;
}

export interface TaskAPI {
  do(taskName: string, data?: Record<string, any>): Promise<any>;
}
