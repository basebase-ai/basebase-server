import * as crypto from "crypto";

// Helper function to generate 72-bit base64 _id ID
export function generateName(): string {
  // Generate 9 bytes (72 bits) of random data
  const randomBytes = crypto.randomBytes(9);
  // Convert to base64 and make URL-safe
  return randomBytes.toString("base64url");
}

// Helper function to generate index name from fields
export function generateIndexName(fields: Record<string, number>): string {
  return Object.entries(fields)
    .map(([field, direction]) => `${field}_${direction}`)
    .join("_");
}
