// Database and MongoDB related interfaces

export interface FirestoreDocument {
  name?: string;
  fields: Record<string, any>;
}

export interface MongoDocument {
  _id?: any; // Allow ObjectId, string, or other types for flexibility
  [key: string]: any;
}

export interface ValidationResult {
  dbExists: boolean;
  collectionExists: boolean;
}

export interface CollectionMetadata {
  projectName: string;
  collectionName: string;
  rules: any[];
  indexes: IndexDefinition[];
  createdAt: Date;
  updatedAt: Date;
}

export interface IndexDefinition {
  fields: Record<string, number>;
  options?: Record<string, any>;
}
