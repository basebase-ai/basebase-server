import { Collection, Db } from "mongodb";
import { getMongoClient } from "./connection";
import { ServerFunction } from "../types/functions";
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

// Helper function to get server functions collection (global basebase functions)
export function getServerFunctionsCollection(): Collection<ServerFunction> {
  const mongoClient = getMongoClient();
  return mongoClient
    .db("basebase")
    .collection<ServerFunction>("server_functions");
}

// Helper function to get project-specific server functions collection
export function getProjectFunctionsCollection(
  projectName: string
): Collection<ServerFunction> {
  const mongoClient = getMongoClient();
  return mongoClient
    .db(projectName)
    .collection<ServerFunction>("server_functions");
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
