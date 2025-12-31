/**
 * MongoDB Testcontainers singleton manager for integration tests.
 *
 * This module provides a shared MongoDB container across all test files
 * for performance. Container is started on first call to getMongoDb()
 * and stays running until closeMongoDb() is called (typically in globalTeardown).
 *
 * @example
 * ```typescript
 * import { getMongoDb, closeMongoDb } from './setup/mongodb';
 *
 * let db: Db;
 *
 * beforeAll(async () => {
 *   db = await getMongoDb();
 * });
 * ```
 */

import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import { type Db, MongoClient } from 'mongodb';

const mongoContainerImage = 'mongo:8';

/**
 * Check if container reuse is enabled via environment variable.
 * When enabled, containers persist between test runs for faster iteration.
 * Ryuk (the cleanup container) is kept enabled as a safety net for orphans.
 */
const isReuseEnabled = process.env['TESTCONTAINERS_REUSE_ENABLE'] === 'true';

// Module-level singleton instances
let container: StartedMongoDBContainer | null = null;
let client: MongoClient | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Ensures the MongoDB container is initialized.
 * Handles concurrent calls by reusing the same initialization promise.
 */
async function ensureInitialized(): Promise<void> {
	if (initPromise) {
		// Initialization in progress or complete, wait for it
		return initPromise;
	}

	if (container) {
		// Already initialized
		return;
	}

	initPromise = (async () => {
		try {
			const mongoContainer = new MongoDBContainer(mongoContainerImage);
			container = await (isReuseEnabled ? mongoContainer.withReuse() : mongoContainer).start();
		} catch (error) {
			initPromise = null;
			container = null;
			throw new Error(`Failed to start MongoDB container: ${error}`);
		}
	})();

	return initPromise;
}

/**
 * Gets or creates a MongoDB connection from the shared Testcontainer.
 * Container is started on first call and reused for subsequent calls.
 * When TESTCONTAINERS_REUSE_ENABLE=true, the container persists between test runs.
 *
 * @returns A MongoDB Db instance connected to the test container
 */
export async function getMongoDb(): Promise<Db> {
	await ensureInitialized();

	if (!container) {
		throw new Error('MongoDB container not initialized');
	}

	if (!client) {
		try {
			const uri = container.getConnectionString();
			client = new MongoClient(uri, {
				// Use directConnection for container
				directConnection: true,
			});
			await client.connect();
		} catch (error) {
			// Clean up container if client connection fails
			if (container) {
				await container.stop().catch(() => {
					// Ignore stop errors, we're already in error state
				});
				container = null;
			}
			client = null;
			throw new Error(`Failed to connect MongoDB client: ${error}`);
		}
	}

	return client.db('monque_test');
}

/**
 * Gets the MongoDB connection string from the running container.
 * Useful for passing to Monque instances in tests.
 *
 * @returns The MongoDB connection URI
 * @throws If container has not been started
 */
export async function getMongoUri(): Promise<string> {
	await ensureInitialized();

	if (!container) {
		throw new Error('MongoDB container not initialized');
	}

	return container.getConnectionString();
}

/**
 * Gets the MongoClient instance connected to the test container.
 * Useful for tests that need direct client access.
 *
 * @returns The MongoClient instance
 */
export async function getMongoClient(): Promise<MongoClient> {
	// Ensure container and client are initialized
	await getMongoDb();

	if (!client) {
		throw new Error('MongoClient not initialized');
	}

	return client;
}

/**
 * Closes the MongoDB connection and optionally stops the container.
 * When TESTCONTAINERS_REUSE_ENABLE=true, the container is kept running
 * for faster subsequent test runs. Should be called in globalTeardown.
 */
export async function closeMongoDb(): Promise<void> {
	if (client) {
		await client.close();
		client = null;
	}

	if (container) {
		// Only stop the container if reuse is disabled
		// When reuse is enabled, keep it running for faster subsequent runs
		if (!isReuseEnabled) {
			await container.stop();
		}
		container = null;
	}
}

/**
 * Checks if the MongoDB container is currently running.
 *
 * @returns true if container is started and client is connected
 */
export function isMongoDbRunning(): boolean {
	return container !== null && client !== null;
}
