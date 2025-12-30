/**
 * Test utilities for Monque integration tests.
 *
 * This module exports utilities for setting up isolated test databases,
 * creating test fixtures, and managing test lifecycle with MongoDB Testcontainers.
 *
 * @packageDocumentation
 *
 * @example
 * ```typescript
 * import { getTestDb, cleanupTestDb, waitFor, JobFactory } from '@monque/core/testing';
 * import { describe, it, beforeAll, afterAll } from 'vitest';
 * import type { Db } from 'mongodb';
 *
 * describe('MyJobProcessor', () => {
 *   let db: Db;
 *
 *   beforeAll(async () => {
 *     db = await getTestDb('my-processor');
 *   });
 *
 *   afterAll(async () => {
 *     await cleanupTestDb(db);
 *   });
 *
 *   it('should process jobs correctly', async () => {
 *     const job = JobFactory.build({ name: 'test-job' });
 *     // ... test implementation
 *   });
 * });
 * ```
 */

export { JobFactory, JobFactoryHelpers } from '../../tests/factories/job.factory.js';
export { TEST_CONSTANTS } from '../../tests/setup/constants.js';
export {
	closeMongoDb,
	getMongoClient,
	getMongoDb,
	getMongoUri,
	isMongoDbRunning,
} from '../../tests/setup/mongodb.js';
export {
	cleanupTestDb,
	clearCollection,
	findJobByQuery,
	getTestDb,
	stopMonqueInstances,
	triggerJobImmediately,
	uniqueCollectionName,
	waitFor,
} from '../../tests/setup/test-utils.js';
