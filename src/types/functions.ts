// Function system related interfaces

export interface ServerFunction {
  _id: string;
  description: string;
  implementationCode: string;
  requiredServices: string[];
  createdAt: Date;
  updatedAt: Date;
  // New fields for user functions
  schedule?: string; // Cron expression (optional)
  enabled?: boolean; // Whether function is active (default: true)
  createdBy?: string; // User ID (undefined for global basebase functions)
  isUserFunction?: boolean; // True for user-defined functions
}

export interface FunctionExecutionContext {
  user: {
    userId: string;
    projectName: string;
  };
  project: {
    name: string;
  };
  // Firebase-style data API
  data: DataAPI;
  // Function calling capability
  functions: FunctionAPI;
  // Console for logging
  console: ConsoleAPI;
}

export interface DataAPI {
  collection(name: string): CollectionAPI;
}

export interface CollectionAPI {
  // Firebase-style methods
  getDoc(id: string): Promise<any | null>;
  getDocs(options?: GetDocsOptions): Promise<any[]>;
  addDoc(data: Record<string, any>): Promise<{ id: string; doc: any }>;
  setDoc(id: string, data: Record<string, any>): Promise<{ doc: any }>;
  updateDoc(
    id: string,
    data: Partial<Record<string, any>>
  ): Promise<{ doc: any }>;
  deleteDoc(id: string): Promise<{ success: boolean }>;
  queryDocs(filter: QueryFilter): Promise<any[]>;
}

export interface GetDocsOptions {
  limit?: number;
  orderBy?: { field: string; direction: "asc" | "desc" };
  startAfter?: string;
}

export interface QueryFilter {
  where?: Array<{
    field: string;
    operator:
      | "=="
      | "!="
      | ">"
      | ">="
      | "<"
      | "<="
      | "in"
      | "not-in"
      | "contains";
    value: any;
  }>;
  orderBy?: { field: string; direction: "asc" | "desc" };
  limit?: number;
}

export interface FunctionAPI {
  call(functionName: string, data?: Record<string, any>): Promise<any>;
}

export interface ConsoleAPI {
  log(...args: any[]): void;
  error(...args: any[]): void;
  warn(...args: any[]): void;
}

export interface ScheduledJob {
  _id: string;
  projectId: string;
  functionId: string;
  cronExpression: string;
  nextRun: Date;
  lastRun?: Date;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}
