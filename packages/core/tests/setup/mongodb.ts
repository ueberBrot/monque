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

// Module-level singleton instances
let container: StartedMongoDBContainer | null = null;
let client: MongoClient | null = null;

/**
 * Gets or creates a MongoDB connection from the shared Testcontainer.
 * Container is started on first call and reused for subsequent calls.
 *
 * @returns A MongoDB Db instance connected to the test container
 */
export async function getMongoDb(): Promise<Db> {
	if (!container) {
		// Start container on first call
		container = await new MongoDBContainer('mongo:8').start();
	}

	if (!client) {
		const uri = container.getConnectionString();
		client = new MongoClient(uri, {
			// Use directConnection for container
			directConnection: true,
		});
		await client.connect();
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
	if (!container) {
		// Start container if not already running
		container = await new MongoDBContainer('mongo:7').start();
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
 * Closes the MongoDB connection and stops the container.
 * Should be called in globalTeardown to clean up resources.
 */
export async function closeMongoDb(): Promise<void> {
	if (client) {
		await client.close();
		client = null;
	}

	if (container) {
		await container.stop();
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
