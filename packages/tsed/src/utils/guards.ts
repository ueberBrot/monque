/**
 * `@monque/tsed` - Type Guards
 *
 * Utilities for duck-typing Mongoose and MongoDB related objects
 * to avoid hard dependencies on @tsed/mongoose.
 */

import type { Db } from "mongodb";

/**
 * Interface representing a Mongoose Connection object.
 * We only care that it has a `db` property which is a MongoDB Db instance.
 */
export interface MongooseConnection {
  db: Db;
}

/**
 * Interface representing the @tsed/mongoose MongooseService.
 * It acts as a registry/factory for connections.
 */
export interface MongooseService {
  /**
   * Get a connection by its ID (configuration key).
   * @param id The connection ID (default: "default")
   */
  // oxlint-disable-next-line typescript/method-signature-style -- Match the public method contract of TsED MongooseService.
  get(id?: string): MongooseConnection | undefined;
}

/**
 * Type guard to check if an object acts like a Mongoose Service.
 *
 * Checks if the object has a `get` method.
 *
 * @param value The value to check
 */
export const isMongooseService = function isMongooseService(
  value: unknown,
): value is MongooseService {
  return (
    typeof value === "object" && value !== null && "get" in value && typeof value.get === "function"
  );
};

/**
 * Type guard to check if an object acts like a Mongoose Connection.
 *
 * Checks if the object has a `db` property.
 *
 * @param value The value to check
 */
export const isMongooseConnection = function isMongooseConnection(
  value: unknown,
): value is MongooseConnection {
  return (
    typeof value === "object" &&
    value !== null &&
    "db" in value &&
    typeof value.db === "object" &&
    value.db !== null &&
    "collection" in value.db &&
    typeof value.db.collection === "function"
  );
};
