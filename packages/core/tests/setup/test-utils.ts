/**
 * Test utilities for MongoDB integration tests.
 *
 * Provides helper functions for isolated test databases and cleanup.
 *
 * @example
 * ```typescript
 * import { getTestDb, cleanupTestDb } from './setup/test-utils';
 *
 * describe('MyTest', () => {
 *   let db: Db;
 *
 *   beforeAll(async () => {
 *     db = await getTestDb('my-test-suite');
 *   });
 *
 *   afterAll(async () => {
 *     await cleanupTestDb(db);
 *   });
 * });
 * ```
 */

import type { Db } from 'mongodb';
import { getMongoClient } from '@tests/setup/mongodb.js';

/**
 * Gets an isolated test database.
 * Each test file should use a unique testName to avoid conflicts.
 *
 * @param testName - A unique identifier for the test suite (used as database name suffix)
 * @returns A MongoDB Db instance for isolated testing
 */
export async function getTestDb(testName: string): Promise<Db> {
	const client = await getMongoClient();
	// Sanitize test name for use as database name
	const sanitizedName = testName.replace(/[^a-zA-Z0-9_-]/g, '_');

	return client.db(`monque_test_${sanitizedName}`);
}

/**
 * Drops the test database to clean up after test suite.
 * Call this in afterAll() to ensure test isolation.
 *
 * @param db - The database instance to drop
 */
export async function cleanupTestDb(db: Db): Promise<void> {
	await db.dropDatabase();
}

/**
 * Clears all documents from a specific collection without dropping it.
 * Useful for cleaning up between tests within the same suite.
 *
 * @param db - The database instance
 * @param collectionName - Name of the collection to clear
 */
export async function clearCollection(db: Db, collectionName: string): Promise<void> {
	await db.collection(collectionName).deleteMany({});
}

/**
 * Creates a unique collection name for test isolation.
 * Useful when running parallel tests that share a database.
 *
 * @param baseName - Base collection name
 * @returns Unique collection name with random suffix
 */
export function uniqueCollectionName(baseName: string): string {
	const suffix = Math.random().toString(36).substring(2, 8);

	return `${baseName}_${suffix}`;
}

/**
 * Waits for a condition to be true with timeout.
 * Useful for testing async operations like job processing.
 *
 * @param condition - Async function that returns true when condition is met
 * @param options - Configuration for polling and timeout
 * @returns Promise that resolves when condition is true
 * @throws Error if timeout is exceeded
 */
export async function waitFor(
	condition: () => Promise<boolean>,
	options: { timeout?: number; interval?: number } = {},
): Promise<void> {
	const { timeout = 10000, interval = 100 } = options;
	const startTime = Date.now();

	while (Date.now() - startTime < timeout) {
		if (await condition()) {
			return;
		}

		await new Promise((resolve) => setTimeout(resolve, interval));
	}

	throw new Error(`waitFor condition not met within ${timeout}ms`);
}

/**
 * Stops multiple Monque instances in parallel.
 * Useful for cleaning up in afterEach/afterAll.
 *
 * @param instances - Array of Monque instances or objects with a stop method
 */
export async function stopMonqueInstances(
	instances: { stop: () => Promise<void> }[],
): Promise<void> {
	await Promise.all(instances.map((i) => i.stop()));
	// Clear the array in place
	instances.length = 0;
}
