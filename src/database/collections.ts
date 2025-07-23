import { Collection, Db } from "mongodb";
import { getMongoClient } from "./connection";
import { CloudTask } from "../types/tasks";
import { Trigger, ScheduledJob } from "../types/triggers";

// Helper function to get database and collection
export function getDbAndCollection(
  projectName: string,
  collectionName: string
): { db: Db; collection: Collection } {
  const mongoClient = getMongoClient();
  const db = mongoClient.db(projectName);
  const collection = db.collection(collectionName);
  return { db, collection };
}

// Helper function to get project-specific cloud tasks collection
export function getProjectTasksCollection(
  projectName: string
): Collection<CloudTask> {
  const mongoClient = getMongoClient();
  return mongoClient.db(projectName).collection<CloudTask>("tasks");
}

// Helper function to get scheduled jobs collection
export function getScheduledJobsCollection(): Collection<ScheduledJob> {
  const mongoClient = getMongoClient();
  return mongoClient.db("basebase").collection<ScheduledJob>("scheduled_jobs");
}

// Helper function to get global triggers collection
export function getTriggersCollection(): Collection<Trigger> {
  const mongoClient = getMongoClient();
  return mongoClient.db("basebase").collection<Trigger>("triggers");
}

// Helper function to get project-specific triggers collection
export function getProjectTriggersCollection(
  projectName: string
): Collection<Trigger> {
  const mongoClient = getMongoClient();
  return mongoClient.db(projectName).collection<Trigger>("triggers");
}
