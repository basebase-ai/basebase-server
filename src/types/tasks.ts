// Cloud task system related interfaces
import {
  DataAPI,
  CollectionAPI,
  GetDocsOptions,
  QueryFilter,
  ConsoleAPI,
} from "./functions";

// Import SDK types from data-api
import type {
  DocumentReference,
  CollectionReference,
  DocumentSnapshot,
  QuerySnapshot,
  DatabaseInstance,
} from "../api/data-api";

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
  // Original collection-based API (still supported)
  data: DataAPI;
  // Task calling capability
  tasks: TaskAPI;
  // Console for logging
  console: ConsoleAPI;

  // Firebase-style SDK functions for familiar patterns
  db: DatabaseInstance;
  doc: (db: DatabaseInstance, path: string) => DocumentReference;
  collection: (db: DatabaseInstance, path: string) => CollectionReference;
  getDoc: (docRef: DocumentReference) => Promise<DocumentSnapshot>;
  getDocs: (collectionRef: CollectionReference) => Promise<QuerySnapshot>;
  addDoc: (
    collectionRef: CollectionReference,
    data: Record<string, any>
  ) => Promise<DocumentReference>;
  setDoc: (
    docRef: DocumentReference,
    data: Record<string, any>
  ) => Promise<void>;
  updateDoc: (
    docRef: DocumentReference,
    data: Partial<Record<string, any>>
  ) => Promise<void>;
  deleteDoc: (docRef: DocumentReference) => Promise<void>;
}

export interface TaskAPI {
  do(taskName: string, data?: Record<string, any>): Promise<any>;
}
