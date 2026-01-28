/**
 * @monque/tsed - Configuration Types
 */

import type { MonqueOptions } from '@monque/core';
import type { TokenProvider } from '@tsed/di';
import type { Db } from 'mongodb';

/**
 * Configuration options for @monque/tsed.
 *
 * Extends MonqueOptions with Ts.ED-specific settings for database resolution
 * and module behavior.
 *
 * @example
 * ```typescript
 * @Configuration({
 *   monque: {
 *     db: mongoClient.db("myapp"),
 *     collectionName: "jobs",
 *     defaultConcurrency: 5
 *   }
 * })
 * export class Server {}
 * ```
 */
export interface MonqueTsedConfig extends MonqueOptions {
	/**
	 * Enable or disable the Monque module.
	 *
	 * When disabled:
	 * - Jobs are not registered
	 * - Lifecycle hooks are no-ops
	 * - MonqueService throws on access
	 *
	 * @default true
	 */
	enabled?: boolean;

	/**
	 * Direct MongoDB database instance.
	 *
	 * Use when you have a pre-connected Db object available synchronously.
	 *
	 * @example
	 * ```typescript
	 * @Configuration({
	 *   monque: {
	 *     db: mongoClient.db("myapp"),
	 *     collectionName: "jobs"
	 *   }
	 * })
	 * ```
	 */
	db?: Db;

	/**
	 * Factory function to create the database connection.
	 *
	 * Called once during module initialization. Supports async factories
	 * for connection pooling or lazy initialization.
	 *
	 * @example
	 * ```typescript
	 * @Configuration({
	 *   monque: {
	 *     dbFactory: async () => {
	 *       const client = await MongoClient.connect(process.env.MONGO_URI!);
	 *       return client.db("myapp");
	 *     }
	 *   }
	 * })
	 * ```
	 */
	dbFactory?: () => Promise<Db> | Db;

	/**
	 * DI token to inject the Db instance from the container.
	 *
	 * Use when your application already has a MongoDB provider registered
	 * in the DI container.
	 *
	 * Can also be used to inject a MongooseService or Connection.
	 *
	 * @example
	 * ```typescript
	 * // First, register a MongoDB provider
	 * registerProvider({
	 *   provide: "MONGODB_DATABASE",
	 *   useFactory: async () => {
	 *     const client = await MongoClient.connect(uri);
	 *     return client.db("myapp");
	 *   }
	 * });
	 *
	 * // Then reference it in config
	 * @Configuration({
	 *   monque: {
	 *     dbToken: "MONGODB_DATABASE"
	 *   }
	 * })
	 * ```
	 */
	dbToken?: TokenProvider<Db> | string;

	/**
	 * Connection ID of the Mongoose connection to use.
	 *
	 * Requires the use of `dbToken` pointing to `MongooseService`.
	 *
	 * @default "default"
	 */
	mongooseConnectionId?: string;

	/**
	 * Disable job processing on this instance.
	 *
	 * When true, the module will initialize the database connection (allowing you to
	 * enqueue jobs via MonqueService) but will NOT register jobs or start the
	 * polling loop. Useful for "Producer-only" nodes like API servers that only
	 * enqueue jobs but don't process them.
	 *
	 * @example
	 * ```typescript
	 * // API Server (Producer-only)
	 * @Configuration({
	 *   monque: {
	 *     dbFactory: async () => client.db('myapp'),
	 *     disableJobProcessing: true, // Only enqueue, don't process
	 *   }
	 * })
	 * export class ApiServer {}
	 *
	 * // Job Server (Consumer)
	 * @Configuration({
	 *   monque: {
	 *     dbFactory: async () => client.db('myapp'),
	 *     // disableJobProcessing defaults to false - processes jobs
	 *   }
	 * })
	 * export class JobServer {}
	 * ```
	 *
	 * @default false
	 */
	disableJobProcessing?: boolean;
}
