/**
 * Integration tests for instance collision detection with real MongoDB.
 *
 * Verifies:
 * - Second instance with same schedulerInstanceId is rejected when first is active
 * - Second instance allowed after first stops (no false positive)
 * - Second instance allowed after crash recovery (stale heartbeat)
 */

import { TEST_CONSTANTS } from '@test-utils/constants.js';
import {
	cleanupTestDb,
	clearCollection,
	getTestDb,
	stopMonqueInstances,
	uniqueCollectionName,
	waitFor,
} from '@test-utils/test-utils.js';
import type { Db } from 'mongodb';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { JobFactoryHelpers } from '@tests/factories/job.factory.js';
import { Monque } from '@/scheduler';
import { ConnectionError } from '@/shared';

describe('Instance Collision Detection', () => {
	let db: Db;
	let collectionName: string;
	const monqueInstances: Monque[] = [];

	beforeAll(async () => {
		db = await getTestDb('instance-collision');
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

	it('throws when second instance initializes with same schedulerInstanceId while first is active', async () => {
		collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
		const sharedId = 'shared-collision-id';

		const monque1 = new Monque(db, {
			collectionName,
			schedulerInstanceId: sharedId,
			pollInterval: 100,
			heartbeatInterval: 200,
			lockTimeout: 60_000,
		});
		monqueInstances.push(monque1);
		await monque1.initialize();

		// Register a long-running worker and start processing
		let jobStarted = false;
		monque1.register(TEST_CONSTANTS.JOB_NAME, async () => {
			jobStarted = true;
			// Hold the job long enough for the test
			await new Promise((resolve) => setTimeout(resolve, 5000));
		});

		await monque1.enqueue(TEST_CONSTANTS.JOB_NAME, { value: 'collision-test' });
		monque1.start();

		// Wait for the job to start processing and heartbeat to be written
		await waitFor(async () => jobStarted, { timeout: 5000 });
		// Wait for at least one heartbeat cycle
		await new Promise((resolve) => setTimeout(resolve, 300));

		// Create second instance with same ID — should fail
		const monque2 = new Monque(db, {
			collectionName,
			schedulerInstanceId: sharedId,
			pollInterval: 100,
			heartbeatInterval: 200,
			lockTimeout: 60_000,
		});
		monqueInstances.push(monque2);

		await expect(monque2.initialize()).rejects.toThrow(ConnectionError);
		await expect(
			// Need fresh instance since initialize() may have partially set state
			new Monque(db, {
				collectionName,
				schedulerInstanceId: sharedId,
				pollInterval: 100,
				heartbeatInterval: 200,
				lockTimeout: 60_000,
			}).initialize(),
		).rejects.toThrow(/schedulerInstanceId/);
	});

	it('allows second instance after first stops (no false positive)', async () => {
		collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
		const sharedId = 'stop-then-start-id';

		const monque1 = new Monque(db, {
			collectionName,
			schedulerInstanceId: sharedId,
			pollInterval: 100,
			heartbeatInterval: 200,
			lockTimeout: 60_000,
		});
		monqueInstances.push(monque1);
		await monque1.initialize();

		// Register worker, process a job, then stop
		let completed = false;
		monque1.on('job:complete', () => {
			completed = true;
		});
		monque1.register(TEST_CONSTANTS.JOB_NAME, async () => {
			// Quick job
		});

		await monque1.enqueue(TEST_CONSTANTS.JOB_NAME, { value: 'will-complete' });
		monque1.start();

		await waitFor(async () => completed, { timeout: 5000 });
		await monque1.stop();

		// Second instance with same ID should succeed (job is completed, not processing)
		const monque2 = new Monque(db, {
			collectionName,
			schedulerInstanceId: sharedId,
			pollInterval: 100,
			heartbeatInterval: 200,
			lockTimeout: 60_000,
		});
		monqueInstances.push(monque2);

		await expect(monque2.initialize()).resolves.toBeUndefined();
	});

	it('allows second instance after crash recovery (stale heartbeat)', async () => {
		collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
		const sharedId = 'crashed-instance-id';
		const lockTimeout = 1000;

		// Insert a fake processing document with an old heartbeat directly into the collection
		// This simulates a crashed instance that left a processing job behind
		const collection = db.collection(collectionName);
		const staleTime = new Date(Date.now() - 60_000); // 60 seconds ago

		const staleJob = JobFactoryHelpers.processing({
			name: 'stale-crash-job',
			data: { value: 'from-crashed-instance' },
			nextRunAt: new Date(Date.now() - 10_000),
			claimedBy: sharedId,
			lockedAt: staleTime,
			lastHeartbeat: staleTime,
			heartbeatInterval: 200,
			createdAt: staleTime,
			updatedAt: staleTime,
		});
		await collection.insertOne(staleJob);

		// Create monque2 with stale recovery enabled (default)
		// Stale recovery runs first (resets the old doc to pending),
		// then collision check finds no active processing jobs → success
		const monque2 = new Monque(db, {
			collectionName,
			schedulerInstanceId: sharedId,
			pollInterval: 100,
			heartbeatInterval: 200,
			lockTimeout,
			recoverStaleJobs: true,
		});
		monqueInstances.push(monque2);

		await expect(monque2.initialize()).resolves.toBeUndefined();

		// Verify the stale job was recovered to pending
		const doc = await collection.findOne({ name: 'stale-crash-job' });
		expect(doc?.['status']).toBe('pending');
		expect(doc?.['claimedBy']).toBeUndefined();
	});
});
