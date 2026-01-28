/**
 * @monque/tsed - Database Resolution Utility
 *
 * Multi-strategy database resolution for flexible MongoDB connection handling.
 */

import { ConnectionError } from '@monque/core';
import type { TokenProvider } from '@tsed/di';
import type { Db } from 'mongodb';

import type { MonqueTsedConfig } from '@/config';

import { isMongooseConnection, isMongooseService } from './guards.js';

/**
 * Type for the injector function used to resolve DI tokens.
 */
export type InjectorFn = <T>(token: TokenProvider<T>) => T | undefined;

/**
 * Resolve the MongoDB database instance from the configuration.
 *
 * Supports three resolution strategies:
 * 1. **Direct `db`**: Returns the provided Db instance directly
 * 2. **Factory `dbFactory`**: Calls the factory function (supports async)
 * 3. **DI Token `dbToken`**: Resolves the Db from the DI container
 *
 * @param config - The Monque configuration containing database settings
 * @param injectorFn - Optional function to resolve DI tokens (required for dbToken strategy)
 * @returns The resolved MongoDB Db instance
 * @throws Error if no database strategy is provided or if DI resolution fails
 *
 * @example
 * ```typescript
 * // Direct Db instance
 * const db = await resolveDatabase({ db: mongoDb });
 *
 * // Factory function
 * const db = await resolveDatabase({
 *   dbFactory: async () => {
 *     const client = await MongoClient.connect(uri);
 *     return client.db("myapp");
 *   }
 * });
 *
 * // DI token
 * const db = await resolveDatabase(
 *   { dbToken: "MONGODB_DATABASE" },
 *   (token) => injector.get(token)
 * );
 * ```
 */
export async function resolveDatabase(
	config: MonqueTsedConfig,
	injectorFn?: InjectorFn,
): Promise<Db> {
	// Strategy 1: Direct Db instance
	if (config.db) {
		return config.db;
	}

	// Strategy 2: Factory function (sync or async)
	if (config.dbFactory) {
		return config.dbFactory();
	}

	// Strategy 3: DI token resolution
	if (config.dbToken) {
		if (!injectorFn) {
			throw new ConnectionError(
				'MonqueTsedConfig.dbToken requires an injector function to resolve the database',
			);
		}

		const resolved = injectorFn(config.dbToken);

		if (!resolved) {
			throw new ConnectionError(
				`Could not resolve database from token: ${String(config.dbToken)}. ` +
					'Make sure the provider is registered in the DI container.',
			);
		}

		if (isMongooseService(resolved)) {
			// Check for Mongoose Service (duck typing)
			// It has a get() method that returns a connection
			const connectionId = config.mongooseConnectionId || 'default';
			const connection = resolved.get(connectionId);

			if (!connection) {
				throw new ConnectionError(
					`MongooseService resolved from token "${String(config.dbToken)}" returned no connection for ID "${connectionId}". ` +
						'Ensure the connection ID is correct and the connection is established.',
				);
			}

			if ('db' in connection && connection.db) {
				return connection.db as Db;
			}
		}

		if (isMongooseConnection(resolved)) {
			// Check for Mongoose Connection (duck typing)
			// It has a db property that is the native Db instance
			return resolved.db as Db;
		}

		// Default: Assume it is a native Db instance
		if (typeof resolved !== 'object' || resolved === null || !('collection' in resolved)) {
			throw new ConnectionError(
				`Resolved value from token "${String(config.dbToken)}" does not appear to be a valid MongoDB Db instance.`,
			);
		}

		return resolved as Db;
	}

	// No strategy provided
	throw new ConnectionError("MonqueTsedConfig requires 'db', 'dbFactory', or 'dbToken' to be set");
}
