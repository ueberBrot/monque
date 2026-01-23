/**
 * @monque/tsed - Configuration
 *
 * Defines the configuration interface and TsED module augmentation.
 */

import type { MonqueOptions } from '@monque/core';
import type { TokenProvider } from '@tsed/di';
import type { Db } from 'mongodb';

// ─────────────────────────────────────────────────────────────────────────────
// Configuration Interface
// ─────────────────────────────────────────────────────────────────────────────

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
export interface MonqueTsedConfig extends Omit<MonqueOptions, 'db'> {
	/**
	 * Enable or disable the Monque module.
	 *
	 * When disabled:
	 * - Workers are not registered
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
}

// ─────────────────────────────────────────────────────────────────────────────
// TsED Module Augmentation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Augment TsED's Configuration interface to include monque settings.
 *
 * This allows type-safe configuration via @Configuration decorator.
 */
declare global {
	namespace TsED {
		interface Configuration {
			/**
			 * Monque job queue configuration.
			 */
			monque?: MonqueTsedConfig;
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate that exactly one database resolution strategy is provided.
 *
 * @param config - The configuration to validate.
 * @throws Error if zero or multiple strategies are provided.
 *
 * @example
 * ```typescript
 * validateDatabaseConfig({ db: mongoDb }); // OK
 * validateDatabaseConfig({}); // throws
 * validateDatabaseConfig({ db: mongoDb, dbFactory: fn }); // throws
 * ```
 */
export function validateDatabaseConfig(config: MonqueTsedConfig): void {
	const strategies = [config.db, config.dbFactory, config.dbToken].filter(Boolean);

	if (strategies.length === 0) {
		throw new Error(
			"MonqueTsedConfig requires exactly one of 'db', 'dbFactory', or 'dbToken' to be set",
		);
	}

	if (strategies.length > 1) {
		throw new Error(
			"MonqueTsedConfig accepts only one of 'db', 'dbFactory', or 'dbToken' - multiple were provided",
		);
	}
}
