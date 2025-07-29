import { getDbAndCollection } from "./collections";

export interface SecurityRule {
  match: string;
  allow: string[];
  condition: string;
}

/**
 * Default security rules that enforce ownerId-based access control
 */
export const DEFAULT_OWNER_SECURITY_RULES: SecurityRule[] = [
  {
    match: "/documents/{document}",
    allow: ["read"],
    condition: "true", // Allow all reads for now - can be tightened later
  },
  {
    match: "/documents/{document}",
    allow: ["write"],
    condition:
      "auth != null && (resource == null || resource.data.ownerId == auth.uid)", // Allow creates and owner updates
  },
  {
    match: "/documents/{document}",
    allow: ["delete"],
    condition: "auth != null && resource.data.ownerId == auth.uid", // Only owner can delete
  },
];

/**
 * Automatically initializes security rules for a collection if they don't exist.
 * This should be called before any document operations on a collection.
 */
export async function ensureCollectionSecurity(
  projectName: string,
  collectionName: string
): Promise<void> {
  const { db } = getDbAndCollection(projectName, collectionName);
  const collectionsCollection = db.collection("collections");

  // Check if security rules already exist for this collection
  const existingMetadata = await collectionsCollection.findOne({
    projectName,
    collectionName,
  });

  if (
    existingMetadata &&
    existingMetadata.rules &&
    existingMetadata.rules.length > 0
  ) {
    // Security rules already exist, no need to initialize
    return;
  }

  // Apply default security rules automatically
  await setDefaultSecurityRules(projectName, collectionName);
  console.log(
    `🔒 Auto-applied security rules to new collection: ${projectName}/${collectionName}`
  );
}

/**
 * Sets default security rules for a specific collection
 */
export async function setDefaultSecurityRules(
  projectName: string,
  collectionName: string,
  customRules?: SecurityRule[]
): Promise<void> {
  const rules = customRules || DEFAULT_OWNER_SECURITY_RULES;

  const { db } = getDbAndCollection(projectName, collectionName);
  const collectionsCollection = db.collection("collections");

  const now = new Date();
  await collectionsCollection.updateOne(
    {
      projectName,
      collectionName,
    },
    {
      $set: {
        projectName,
        collectionName,
        rules,
        updatedAt: now,
      },
      $setOnInsert: {
        createdAt: now,
        indexes: [],
      },
    },
    { upsert: true }
  );

  console.log(
    `Set default security rules for ${projectName}/${collectionName}`
  );
}

/**
 * Sets default security rules for all collections in a database/project
 */
export async function setDatabaseWideSecurityRules(
  projectName: string,
  customRules?: SecurityRule[]
): Promise<void> {
  const rules = customRules || DEFAULT_OWNER_SECURITY_RULES;

  const { db } = getDbAndCollection(projectName, "_temp"); // Just to get the db instance
  const collectionsCollection = db.collection("collections");

  // Get all existing collection metadata
  const existingCollections = await collectionsCollection
    .find({ projectName })
    .toArray();

  // Update rules for all existing collections
  for (const collectionDoc of existingCollections) {
    await setDefaultSecurityRules(
      projectName,
      collectionDoc.collectionName,
      rules
    );
  }

  // Also get all actual collections in the database to cover any that don't have metadata
  const collections = await db.listCollections().toArray();
  for (const collection of collections) {
    const collectionName = collection.name;

    // Skip system collections
    if (
      collectionName.startsWith("system.") ||
      collectionName === "collections"
    ) {
      continue;
    }

    await setDefaultSecurityRules(projectName, collectionName, rules);
  }

  console.log(
    `Set database-wide security rules for all collections in ${projectName}`
  );
}

/**
 * Initializes default security rules for a project when it's created
 */
export async function initializeProjectSecurity(
  projectName: string
): Promise<void> {
  await setDatabaseWideSecurityRules(projectName);
  console.log(`Initialized security rules for project: ${projectName}`);
}
