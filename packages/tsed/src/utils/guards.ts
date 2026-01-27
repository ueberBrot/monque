/**
 * @monque/tsed - Type Guards
 *
 * Utilities for duck-typing Mongoose and MongoDB related objects
 * to avoid hard dependencies on @tsed/mongoose.
 */

import type { Db } from 'mongodb';

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
	get(id?: string): MongooseConnection | undefined;
}

/**
 * Type guard to check if an object acts like a Mongoose Service.
 *
 * Checks if the object has a `get` method.
 *
 * @param value The value to check
 */
export function isMongooseService(value: unknown): value is MongooseService {
	return (
		typeof value === 'object' &&
		value !== null &&
		'get' in value &&
		typeof (value as MongooseService).get === 'function'
	);
}

/**
 * Type guard to check if an object acts like a Mongoose Connection.
 *
 * Checks if the object has a `db` property.
 *
 * @param value The value to check
 */
export function isMongooseConnection(value: unknown): value is MongooseConnection {
	return (
		typeof value === 'object' &&
		value !== null &&
		'db' in value &&
		typeof (value as MongooseConnection).db === 'object' &&
		(value as MongooseConnection).db !== null &&
		typeof (value as MongooseConnection).db.collection === 'function'
	);
}
