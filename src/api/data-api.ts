import {
  DataAPI,
  CollectionAPI,
  GetDocsOptions,
  QueryFilter,
} from "../types/functions";
import { getDbAndCollection } from "../database/collections";
import {
  isValidCollectionName,
  buildDocumentQuery,
} from "../database/validation";
import {
  convertFromFirestoreFormat,
  convertToFirestoreFormat,
} from "../database/conversion";
import { generateName } from "../utils/generators";

// Firebase-style data API implementation
export class ProjectDataAPI implements DataAPI {
  constructor(private projectName: string) {}

  collection(name: string): CollectionAPI {
    if (!isValidCollectionName(name)) {
      throw new Error("Invalid collection name");
    }
    return new ProjectCollectionAPI(this.projectName, name);
  }
}

export class ProjectCollectionAPI implements CollectionAPI {
  constructor(private projectName: string, private collectionName: string) {}

  async getDoc(id: string): Promise<any | null> {
    const { collection } = getDbAndCollection(
      this.projectName,
      this.collectionName
    );
    const query = buildDocumentQuery(id);
    const doc = await collection.findOne(query);
    return doc ? convertToFirestoreFormat(doc) : null;
  }

  async getDocs(options?: GetDocsOptions): Promise<any[]> {
    const { collection } = getDbAndCollection(
      this.projectName,
      this.collectionName
    );
    let query = collection.find({});

    if (options?.orderBy) {
      const sortDirection = options.orderBy.direction === "desc" ? -1 : 1;
      const sortObj: any = { [options.orderBy.field]: sortDirection };
      query = query.sort(sortObj);
    }

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    const docs = await query.toArray();
    return docs.map((doc) => convertToFirestoreFormat(doc));
  }

  async addDoc(data: Record<string, any>): Promise<{ id: string; doc: any }> {
    const { collection } = getDbAndCollection(
      this.projectName,
      this.collectionName
    );
    const document = convertFromFirestoreFormat({ fields: data });

    // Generate unique ID
    const documentId = generateName();
    document._id = documentId;

    const now = new Date();
    document.createdAt = now;
    document.updatedAt = now;

    await collection.insertOne(document);

    return {
      id: documentId,
      doc: convertToFirestoreFormat(document),
    };
  }

  async setDoc(id: string, data: Record<string, any>): Promise<{ doc: any }> {
    const { collection } = getDbAndCollection(
      this.projectName,
      this.collectionName
    );
    const document = convertFromFirestoreFormat({ fields: data });

    const query = buildDocumentQuery(id);
    const existingDoc = await collection.findOne(query);

    const now = new Date();
    if (existingDoc) {
      document._id = existingDoc._id;
      document.createdAt = existingDoc.createdAt || now;
      document.updatedAt = now;
      await collection.replaceOne(query, document);
    } else {
      document._id = id;
      document.createdAt = now;
      document.updatedAt = now;
      await collection.insertOne(document);
    }

    return { doc: convertToFirestoreFormat(document) };
  }

  async updateDoc(
    id: string,
    data: Partial<Record<string, any>>
  ): Promise<{ doc: any }> {
    const { collection } = getDbAndCollection(
      this.projectName,
      this.collectionName
    );
    const updateData = convertFromFirestoreFormat({ fields: data });

    delete updateData._id;
    updateData.updatedAt = new Date();

    const query = buildDocumentQuery(id);
    await collection.updateOne(query, { $set: updateData });

    const updatedDoc = await collection.findOne(query);
    if (!updatedDoc) {
      throw new Error("Document not found");
    }

    return { doc: convertToFirestoreFormat(updatedDoc) };
  }

  async deleteDoc(id: string): Promise<{ success: boolean }> {
    const { collection } = getDbAndCollection(
      this.projectName,
      this.collectionName
    );
    const query = buildDocumentQuery(id);
    const result = await collection.deleteOne(query);

    return { success: result.deletedCount > 0 };
  }

  async queryDocs(filter: QueryFilter): Promise<any[]> {
    const { collection } = getDbAndCollection(
      this.projectName,
      this.collectionName
    );

    // Convert filter to MongoDB query
    let mongoQuery: any = {};
    if (filter.where) {
      for (const condition of filter.where) {
        const { field, operator, value } = condition;

        switch (operator) {
          case "==":
            mongoQuery[field] = value;
            break;
          case "!=":
            mongoQuery[field] = { $ne: value };
            break;
          case ">":
            mongoQuery[field] = { $gt: value };
            break;
          case ">=":
            mongoQuery[field] = { $gte: value };
            break;
          case "<":
            mongoQuery[field] = { $lt: value };
            break;
          case "<=":
            mongoQuery[field] = { $lte: value };
            break;
          case "in":
            mongoQuery[field] = { $in: Array.isArray(value) ? value : [value] };
            break;
          case "not-in":
            mongoQuery[field] = {
              $nin: Array.isArray(value) ? value : [value],
            };
            break;
          case "contains":
            mongoQuery[field] = value;
            break;
        }
      }
    }

    let query = collection.find(mongoQuery);

    if (filter.orderBy) {
      const sortDirection = filter.orderBy.direction === "desc" ? -1 : 1;
      const sortObj: any = { [filter.orderBy.field]: sortDirection };
      query = query.sort(sortObj);
    }

    if (filter.limit) {
      query = query.limit(filter.limit);
    }

    const docs = await query.toArray();
    return docs.map((doc) => convertToFirestoreFormat(doc));
  }
}

// Firebase-style SDK compatibility layer for cloud tasks
export interface DocumentReference {
  id: string;
  path: string;
  projectName: string;
  collectionName: string;
}

export interface CollectionReference {
  path: string;
  projectName: string;
  collectionName: string;
}

export interface DocumentSnapshot {
  id: string;
  exists: boolean;
  data(): any | null;
  ref: DocumentReference;
}

export interface QuerySnapshot {
  docs: DocumentSnapshot[];
  size: number;
  empty: boolean;
  forEach(callback: (doc: DocumentSnapshot) => void): void;
}

export interface DatabaseInstance {
  projectName: string;
}

// SDK-style functions for cloud tasks
export function createSDKFunctions(projectName: string) {
  const db: DatabaseInstance = { projectName };

  function doc(db: DatabaseInstance, path: string): DocumentReference {
    const pathParts = path.split("/");
    if (pathParts.length !== 2) {
      throw new Error('Document path must be in format "collection/document"');
    }

    const [collectionName, documentId] = pathParts;
    if (!isValidCollectionName(collectionName)) {
      throw new Error("Invalid collection name");
    }

    return {
      id: documentId,
      path,
      projectName: db.projectName,
      collectionName,
    };
  }

  function collection(db: DatabaseInstance, path: string): CollectionReference {
    if (!isValidCollectionName(path)) {
      throw new Error("Invalid collection name");
    }

    return {
      path,
      projectName: db.projectName,
      collectionName: path,
    };
  }

  async function getDoc(docRef: DocumentReference): Promise<DocumentSnapshot> {
    const { collection } = getDbAndCollection(
      docRef.projectName,
      docRef.collectionName
    );
    const query = buildDocumentQuery(docRef.id);
    const doc = await collection.findOne(query);

    const docData = doc ? convertToFirestoreFormat(doc) : null;

    return {
      id: docRef.id,
      exists: !!doc,
      data: () => docData?.fields || null,
      ref: docRef,
    };
  }

  async function getDocs(
    collectionRef: CollectionReference
  ): Promise<QuerySnapshot> {
    const { collection } = getDbAndCollection(
      collectionRef.projectName,
      collectionRef.collectionName
    );

    const docs = await collection.find({}).toArray();
    const snapshots: DocumentSnapshot[] = docs.map((doc) => {
      const docData = convertToFirestoreFormat(doc);
      const docRef: DocumentReference = {
        id: doc._id.toString(),
        path: `${collectionRef.collectionName}/${doc._id}`,
        projectName: collectionRef.projectName,
        collectionName: collectionRef.collectionName,
      };

      return {
        id: doc._id.toString(),
        exists: true,
        data: () => docData.fields || null,
        ref: docRef,
      };
    });

    return {
      docs: snapshots,
      size: snapshots.length,
      empty: snapshots.length === 0,
      forEach: (callback: (doc: DocumentSnapshot) => void) => {
        snapshots.forEach(callback);
      },
    };
  }

  async function addDoc(
    collectionRef: CollectionReference,
    data: Record<string, any>
  ): Promise<DocumentReference> {
    const collectionAPI = new ProjectCollectionAPI(
      collectionRef.projectName,
      collectionRef.collectionName
    );
    const result = await collectionAPI.addDoc(data);

    return {
      id: result.id,
      path: `${collectionRef.collectionName}/${result.id}`,
      projectName: collectionRef.projectName,
      collectionName: collectionRef.collectionName,
    };
  }

  async function setDoc(
    docRef: DocumentReference,
    data: Record<string, any>
  ): Promise<void> {
    const collectionAPI = new ProjectCollectionAPI(
      docRef.projectName,
      docRef.collectionName
    );
    await collectionAPI.setDoc(docRef.id, data);
  }

  async function updateDoc(
    docRef: DocumentReference,
    data: Partial<Record<string, any>>
  ): Promise<void> {
    const collectionAPI = new ProjectCollectionAPI(
      docRef.projectName,
      docRef.collectionName
    );
    await collectionAPI.updateDoc(docRef.id, data);
  }

  async function deleteDoc(docRef: DocumentReference): Promise<void> {
    const collectionAPI = new ProjectCollectionAPI(
      docRef.projectName,
      docRef.collectionName
    );
    await collectionAPI.deleteDoc(docRef.id);
  }

  return {
    db,
    doc,
    collection,
    getDoc,
    getDocs,
    addDoc,
    setDoc,
    updateDoc,
    deleteDoc,
  };
}
