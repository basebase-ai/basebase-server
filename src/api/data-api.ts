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
