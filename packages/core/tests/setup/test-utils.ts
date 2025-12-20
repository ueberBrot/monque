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

import type { Collection, Db, Document, ObjectId } from 'mongodb';

import { getMongoClient } from '@tests/setup/mongodb.js';
import type { Job } from '@/types.js';

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

	const elapsed = Date.now() - startTime;
	throw new Error(
		`waitFor condition not met within ${timeout}ms (elapsed: ${elapsed}ms). ` +
			`Consider increasing timeout or checking test conditions.`,
	);
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

/**
 * Updates a job's nextRunAt to now for immediate execution in tests.
 * Useful for triggering scheduled jobs immediately without waiting for their scheduled time.
 *
 * @param collection - The MongoDB collection containing the job
 * @param jobId - The ObjectId of the job to trigger
 */
export async function triggerJobImmediately(
	collection: Collection,
	jobId: ObjectId,
): Promise<void> {
	await collection.updateOne({ _id: jobId }, { $set: { nextRunAt: new Date() } });
}

/**
 * Finds a job by a custom query and returns it typed as Job.
 * This helper eliminates the need for unsafe double-casting (as unknown as Job)
 * when querying jobs directly from the collection in tests.
 *
 * @param collection - The MongoDB collection containing jobs
 * @param query - MongoDB query to find the job
 * @returns The job if found, null otherwise
 *
 * @example
 * ```typescript
 * const job = await findJobByQuery<{ id: number }>(collection, { 'data.id': 1 });
 * expect(job?.status).toBe(JobStatus.PENDING);
 * ```
 */
export async function findJobByQuery<T = unknown>(
	collection: Collection,
	query: Document,
): Promise<Job<T> | null> {
	const doc = await collection.findOne(query);
	return doc as Job<T> | null;
}
