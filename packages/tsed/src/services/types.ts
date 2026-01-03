import type { MonqueOptions } from '@monque/core';
import type { Db, MongoClient } from 'mongodb';

/**
 * Configuration interface for Monque scheduler integration.
 *
 * Pass this configuration via `@Configuration({ monque: { ... } })` in your Ts.ED server.
 * The scheduler remains inactive unless `enabled: true` is set.
 *
 * @example Basic configuration with database URL
 * ```typescript
 * @Configuration({
 *   monque: {
 *     enabled: true,
 *     url: 'mongodb://localhost:27017/myapp',
 *     pollInterval: 1000,
 *     maxRetries: 10
 *   }
 * })
 * export class Server {}
 * ```
 *
 * @example Using existing MongoClient
 * ```typescript
 * const client = new MongoClient('mongodb://localhost:27017');
 * await client.connect();
 *
 * @Configuration({
 *   monque: {
 *     enabled: true,
 *     client: client,
 *     pollInterval: 1000
 *   }
 * })
 * export class Server {}
 * ```
 *
 * @example Async database factory
 * ```typescript
 * @Configuration({
 *   monque: {
 *     enabled: true,
 *     db: async () => {
 *       const client = await getMongoClient();
 *       return client.db('myapp');
 *     }
 *   }
 * })
 * export class Server {}
 * ```
 */
export interface MonqueSettings extends Omit<MonqueOptions, 'schedulerInstanceId'> {
	/**
	 * Enable or disable the Monque scheduler.
	 *
	 * When `false`, the service returns a no-op proxy and no resources are initialized.
	 *
	 * @default false
	 */
	enabled: boolean;

	/**
	 * MongoDB connection URL.
	 *
	 * Mutually exclusive with `client` and `db`.
	 * When provided, a new MongoClient connection is created.
	 *
	 * @example
	 * ```typescript
	 * { url: 'mongodb://localhost:27017/mydb' }
	 * ```
	 */
	url?: string;

	/**
	 * MongoDB client instance.
	 *
	 * Mutually exclusive with `url` and `db`.
	 * The default database from the client will be used.
	 *
	 * @example
	 * ```typescript
	 * const client = new MongoClient('mongodb://localhost:27017');
	 * { client: client }
	 * ```
	 */
	client?: MongoClient;

	/**
	 * MongoDB database instance or async factory function.
	 *
	 * Mutually exclusive with `url` and `client`.
	 * Use a factory function for lazy initialization when the database
	 * connection is established after module loading.
	 *
	 * @example Direct database
	 * ```typescript
	 * { db: mongoClient.db('myapp') }
	 * ```
	 *
	 * @example Async factory
	 * ```typescript
	 * {
	 *   db: async () => {
	 *     const client = await getMongoClient();
	 *     return client.db('myapp');
	 *   }
	 * }
	 * ```
	 */
	db?: Db | (() => Db | Promise<Db>);
}
