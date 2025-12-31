/**
 * Tests for MongoDB index creation and query performance.
 *
 * These tests verify:
 * - All required indexes are created on initialization
 * - Indexes for atomic claim pattern (claimedBy+status, lastHeartbeat+status)
 * - Compound indexes for atomic claim queries (status+nextRunAt+claimedBy)
 * - Expanded recovery index (lockedAt+lastHeartbeat+status)
 *
 * @see {@link ../src/monque.ts}
 */

import { TEST_CONSTANTS } from '@test-utils/constants.js';
import {
	cleanupTestDb,
	clearCollection,
	getTestDb,
	stopMonqueInstances,
	uniqueCollectionName,
} from '@test-utils/test-utils.js';
import type { Db } from 'mongodb';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { JobFactoryHelpers } from '@tests/factories/job.factory.js';
import { Monque } from '@/monque.js';
import { JobStatus } from '@/types.js';

describe('Index creation', () => {
	let db: Db;
	let collectionName: string;
	const monqueInstances: Monque[] = [];

	beforeAll(async () => {
		db = await getTestDb('indexes');
	});

	afterAll(async () => {
		await cleanupTestDb(db);
	});

	afterEach(async () => {
		await stopMonqueInstances(monqueInstances);
		if (collectionName) {
			await clearCollection(db, collectionName);
		}
	});

	describe('required indexes', () => {
		it('should create all required indexes on initialization', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const collection = db.collection(collectionName);
			const indexes = await collection.indexes();
			const indexKeys = indexes.map((idx) => Object.keys(idx.key).join(','));

			// Core indexes
			expect(indexKeys).toContain('status,nextRunAt');
			expect(indexKeys).toContain('name,uniqueKey');
			expect(indexKeys).toContain('name,status');

			// Atomic claim indexes
			expect(indexKeys).toContain('claimedBy,status');
			expect(indexKeys).toContain('lastHeartbeat,status');
			expect(indexKeys).toContain('status,nextRunAt,claimedBy');
			expect(indexKeys).toContain('lockedAt,lastHeartbeat,status');
		});

		it('should create claimedBy+status compound index for job ownership queries', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const collection = db.collection(collectionName);
			const indexes = await collection.indexes();
			const claimedByIndex = indexes.find(
				(idx) => 'claimedBy' in idx.key && 'status' in idx.key && Object.keys(idx.key).length === 2,
			);

			expect(claimedByIndex).toBeDefined();
			expect(claimedByIndex?.key).toEqual({ claimedBy: 1, status: 1 });
			expect(claimedByIndex?.background).toBe(true);
		});

		it('should create lastHeartbeat+status compound index for stale job detection', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const collection = db.collection(collectionName);
			const indexes = await collection.indexes();
			const heartbeatIndex = indexes.find(
				(idx) =>
					'lastHeartbeat' in idx.key && 'status' in idx.key && Object.keys(idx.key).length === 2,
			);

			expect(heartbeatIndex).toBeDefined();
			expect(heartbeatIndex?.key).toEqual({ lastHeartbeat: 1, status: 1 });
			expect(heartbeatIndex?.background).toBe(true);
		});

		it('should create status+nextRunAt+claimedBy compound index for atomic claim queries', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const collection = db.collection(collectionName);
			const indexes = await collection.indexes();
			const atomicClaimIndex = indexes.find(
				(idx) =>
					'status' in idx.key &&
					'nextRunAt' in idx.key &&
					'claimedBy' in idx.key &&
					Object.keys(idx.key).length === 3,
			);

			expect(atomicClaimIndex).toBeDefined();
			expect(atomicClaimIndex?.key).toEqual({ status: 1, nextRunAt: 1, claimedBy: 1 });
			expect(atomicClaimIndex?.background).toBe(true);
		});

		it('should create expanded lockedAt+lastHeartbeat+status index for recovery queries', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const collection = db.collection(collectionName);
			const indexes = await collection.indexes();
			const recoveryIndex = indexes.find(
				(idx) =>
					'lockedAt' in idx.key &&
					'lastHeartbeat' in idx.key &&
					'status' in idx.key &&
					Object.keys(idx.key).length === 3,
			);

			expect(recoveryIndex).toBeDefined();
			expect(recoveryIndex?.key).toEqual({ lockedAt: 1, lastHeartbeat: 1, status: 1 });
			expect(recoveryIndex?.background).toBe(true);
		});
	});

	describe('query performance with claimedBy+status index', () => {
		it('should use index for finding jobs by owner', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const collection = db.collection(collectionName);
			const instanceId = 'test-instance-123';

			// Insert test jobs using factory helpers
			const job1 = JobFactoryHelpers.processing({
				name: TEST_CONSTANTS.JOB_NAME,
				claimedBy: instanceId,
			});
			const job2 = JobFactoryHelpers.processing({
				name: TEST_CONSTANTS.JOB_NAME,
				claimedBy: 'other-instance',
			});
			await collection.insertMany([job1, job2]);

			// Query using the index
			const explainResult = await collection
				.find({ claimedBy: instanceId, status: JobStatus.PROCESSING })
				.explain('executionStats');

			// Verify index was used (not a collection scan)
			const queryPlanner = explainResult['queryPlanner'] as Record<string, unknown>;
			const winningPlanStr = JSON.stringify(queryPlanner);
			expect(winningPlanStr).toContain('IXSCAN');
		});
	});

	describe('query performance with lastHeartbeat+status index', () => {
		it('should use index for finding stale jobs', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const collection = db.collection(collectionName);
			const staleThreshold = new Date(Date.now() - 30000);

			// Insert test jobs using factory helpers with different heartbeat times
			const staleJob = JobFactoryHelpers.processing({
				name: 'stale-job',
				lastHeartbeat: new Date(Date.now() - 60000), // 60 seconds ago (stale)
			});
			const activeJob = JobFactoryHelpers.processing({
				name: 'active-job',
				lastHeartbeat: new Date(), // Just now (not stale)
			});
			await collection.insertMany([staleJob, activeJob]);

			// Query using the index (find stale jobs)
			const explainResult = await collection
				.find({ status: JobStatus.PROCESSING, lastHeartbeat: { $lt: staleThreshold } })
				.explain('executionStats');

			// Verify index was used
			const queryPlanner = explainResult['queryPlanner'] as Record<string, unknown>;
			const winningPlanStr = JSON.stringify(queryPlanner);
			expect(winningPlanStr).toContain('IXSCAN');
		});
	});
});
