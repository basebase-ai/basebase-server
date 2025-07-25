import { FirestoreDocument, MongoDocument } from "../types/database";

// Helper function to convert Firestore-style document to MongoDB format
export function convertFromFirestoreFormat(firestoreDoc: any): MongoDocument {
  if (!firestoreDoc.fields) {
    return firestoreDoc;
  }

  const mongoDoc: MongoDocument = {};
  for (const [key, value] of Object.entries(firestoreDoc.fields)) {
    if ((value as any).stringValue !== undefined) {
      mongoDoc[key] = (value as any).stringValue;
    } else if ((value as any).integerValue !== undefined) {
      mongoDoc[key] = parseInt((value as any).integerValue);
    } else if ((value as any).doubleValue !== undefined) {
      mongoDoc[key] = parseFloat((value as any).doubleValue);
    } else if ((value as any).booleanValue !== undefined) {
      mongoDoc[key] = (value as any).booleanValue;
    } else if ((value as any).nullValue !== undefined) {
      mongoDoc[key] = null;
    } else if ((value as any).timestampValue !== undefined) {
      mongoDoc[key] = new Date((value as any).timestampValue);
    } else if ((value as any).arrayValue !== undefined) {
      // Handle Firebase arrayValue format
      const arrayValue = (value as any).arrayValue;
      if (arrayValue.values && Array.isArray(arrayValue.values)) {
        mongoDoc[key] = arrayValue.values.map((item: any) => {
          // Convert each array item from Firebase format
          if (item.stringValue !== undefined) {
            return item.stringValue;
          } else if (item.integerValue !== undefined) {
            return parseInt(item.integerValue);
          } else if (item.doubleValue !== undefined) {
            return parseFloat(item.doubleValue);
          } else if (item.booleanValue !== undefined) {
            return item.booleanValue;
          } else if (item.nullValue !== undefined) {
            return null;
          } else if (item.timestampValue !== undefined) {
            return new Date(item.timestampValue);
          } else if (item.arrayValue !== undefined) {
            // Recursively handle nested arrays
            return convertFromFirestoreFormat({ fields: { temp: item } }).temp;
          } else {
            // Return as-is if it's already a plain value
            return item;
          }
        });
      } else {
        // Empty array case
        mongoDoc[key] = [];
      }
    } else {
      mongoDoc[key] = value;
    }
  }
  return mongoDoc;
}

// Helper function to convert MongoDB document to Firestore-style format
export function convertToFirestoreFormat(
  mongoDoc: MongoDocument
): FirestoreDocument {
  const firestoreDoc: FirestoreDocument = { fields: {} };

  for (const [key, value] of Object.entries(mongoDoc)) {
    if (key === "_id") {
      // Use the _id as the document name (convert ObjectId to string if needed)
      firestoreDoc.name = value?.toString() || value;
      continue;
    }

    if (typeof value === "string") {
      firestoreDoc.fields[key] = { stringValue: value };
    } else if (typeof value === "number") {
      if (Number.isInteger(value)) {
        firestoreDoc.fields[key] = { integerValue: value.toString() };
      } else {
        firestoreDoc.fields[key] = { doubleValue: value };
      }
    } else if (typeof value === "boolean") {
      firestoreDoc.fields[key] = { booleanValue: value };
    } else if (value === null) {
      firestoreDoc.fields[key] = { nullValue: null };
    } else if (value instanceof Date) {
      firestoreDoc.fields[key] = { timestampValue: value.toISOString() };
    } else if (Array.isArray(value)) {
      // Handle arrays by converting to Firebase arrayValue format
      firestoreDoc.fields[key] = {
        arrayValue: {
          values: value.map((item: any) => {
            if (typeof item === "string") {
              return { stringValue: item };
            } else if (typeof item === "number") {
              if (Number.isInteger(item)) {
                return { integerValue: item.toString() };
              } else {
                return { doubleValue: item };
              }
            } else if (typeof item === "boolean") {
              return { booleanValue: item };
            } else if (item === null) {
              return { nullValue: null };
            } else if (item instanceof Date) {
              return { timestampValue: item.toISOString() };
            } else if (Array.isArray(item)) {
              // Recursively handle nested arrays
              const nestedArray = convertToFirestoreFormat({
                temp: item,
              } as MongoDocument);
              return nestedArray.fields.temp;
            } else {
              // Return as-is for complex objects
              return item;
            }
          }),
        },
      };
    } else {
      firestoreDoc.fields[key] = value;
    }
  }

  return firestoreDoc;
}
