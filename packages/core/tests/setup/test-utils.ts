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
import { randomUUID } from "node:crypto";
import type { Collection, Db, Document, ObjectId } from "mongodb";

import type { Job } from "@/jobs";
import { getMongoClient } from "@tests/setup/mongodb.js";
/**
 * Gets an isolated test database.
 * Every call allocates a fresh database, including repeated or parallel suite runs.
 *
 * @param testName - A unique identifier for the test suite (used as database name suffix)
 * @returns A MongoDB Db instance for isolated testing
 */
export const getTestDb = async (testName: string): Promise<Db> => {
  const client = await getMongoClient();
  // Sanitize test name for use as database name
  const sanitizedName = testName.replaceAll(/[^a-zA-Z0-9_-]/gu, "_");
  return client.db(`monque_${sanitizedName.slice(0, 20)}_${randomUUID().replaceAll("-", "")}`);
};
/**
 * Drops the test database to clean up after test suite.
 * Call this in afterAll() to ensure test isolation.
 *
 * @param db - The database instance to drop
 */
export const cleanupTestDb = async (db: Db): Promise<void> => {
  await db.dropDatabase();
};
/**
 * Clears all documents from a specific collection without dropping it.
 * Useful for cleaning up between tests within the same suite.
 *
 * @param db - The database instance
 * @param collectionName - Name of the collection to clear
 */
export const clearCollection = async (db: Db, collectionName: string): Promise<void> => {
  await db.collection(collectionName).deleteMany({});
};
/**
 * Creates a unique collection name for test isolation.
 * Useful when running parallel tests that share a database.
 *
 * @param baseName - Base collection name
 * @returns Unique collection name with random suffix
 */
export const uniqueCollectionName = (baseName: string): string => {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${baseName}_${suffix}`;
};
/**
 * Waits for a condition to be true with timeout.
 * Useful for testing async operations like job processing.
 *
 * @param condition - Async function that returns true when condition is met
 * @param options - Configuration for polling and timeout
 * @returns Promise that resolves when condition is true
 * @throws {Error} If timeout is exceeded
 */
export const waitFor = async (
  condition: () => boolean | PromiseLike<boolean>,
  options: {
    timeout?: number;
    interval?: number;
  } = {},
): Promise<void> => {
  const { timeout = 10_000, interval = 100 } = options;
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Poll sequentially so an async probe cannot overlap the next attempt.
    if (await condition()) {
      return;
    }
    const pause: PromiseWithResolvers<void> = Promise.withResolvers();
    setTimeout(pause.resolve, interval);
    // oxlint-disable-next-line eslint/no-await-in-loop -- Every failed probe must wait its interval before another attempt starts.
    await pause.promise;
  }
  const elapsed = Date.now() - startTime;
  throw new Error(
    `waitFor condition not met within ${timeout}ms (elapsed: ${elapsed}ms). ` +
      `Consider increasing timeout or checking test conditions.`,
  );
};
/**
 * Stops multiple Monque instances in parallel.
 * Useful for cleaning up in afterEach/afterAll.
 *
 * @param instances - Array of Monque instances or objects with a stop method
 */
export const stopMonqueInstances = async (
  instances: {
    stop: () => Promise<void>;
  }[],
): Promise<void> => {
  await Promise.all(
    instances.map(async (i) => {
      await i.stop();
    }),
  );
  // Clear the array in place
  instances.length = 0;
};
/**
 * Updates a job's nextRunAt to now for immediate execution in tests.
 * Useful for triggering scheduled jobs immediately without waiting for their scheduled time.
 *
 * @param collection - The MongoDB collection containing the job
 * @param jobId - The ObjectId of the job to trigger
 */
export const triggerJobImmediately = async (
  collection: Pick<Collection<Job>, "updateOne">,
  jobId: ObjectId,
): Promise<void> => {
  await collection.updateOne({ _id: jobId }, { $set: { nextRunAt: new Date() } });
};
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
export const findJobByQuery = async <T = unknown>(
  collection: Pick<Collection, "findOne">,
  query: Document,
): Promise<Job<T> | null> => await collection.findOne<Job<T>>(query);
