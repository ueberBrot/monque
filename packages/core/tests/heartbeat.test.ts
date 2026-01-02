/**
 * Tests for heartbeat mechanism during job processing.
 *
 * These tests verify:
 * - lastHeartbeat is updated periodically while processing
 * - Heartbeat interval is configurable
 * - Stale jobs are detected using lastHeartbeat
 * - Heartbeat mechanism stops on job completion/failure
 * - Heartbeat cleanup occurs on scheduler shutdown
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

import { JobStatus } from '@/jobs/types.js';
import { Monque } from '@/scheduler/monque.js';

import { JobFactoryHelpers } from './factories/job.factory.js';

describe('heartbeat mechanism', () => {
	let db: Db;
	let collectionName: string;
	const monqueInstances: Monque[] = [];

	beforeAll(async () => {
		db = await getTestDb('heartbeat');
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

	describe('heartbeat updates during processing', () => {
		it('should set lastHeartbeat when claiming a job', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, {
				collectionName,
				pollInterval: 100,
				heartbeatInterval: 100,
			});
			monqueInstances.push(monque);
			await monque.initialize();

			let jobStarted = false;
			monque.worker(TEST_CONSTANTS.JOB_NAME, async () => {
				jobStarted = true;
				await new Promise((resolve) => setTimeout(resolve, 500));
			});

			await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { value: 1 });
			monque.start();

			await waitFor(async () => jobStarted, { timeout: 5000 });

			const collection = db.collection(collectionName);
			const doc = await collection.findOne({ name: TEST_CONSTANTS.JOB_NAME });

			expect(doc?.['lastHeartbeat']).toBeInstanceOf(Date);
			expect(doc?.['heartbeatInterval']).toBe(100);
		});

		it('should update lastHeartbeat periodically while processing', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const heartbeatInterval = 100; // 100ms for faster test
			const monque = new Monque(db, {
				collectionName,
				pollInterval: 50,
				heartbeatInterval,
			});
			monqueInstances.push(monque);
			await monque.initialize();

			const heartbeatTimestamps: Date[] = [];

			monque.worker(TEST_CONSTANTS.JOB_NAME, async () => {
				// Hold the job long enough for multiple heartbeats
				const collection = db.collection(collectionName);

				// Record initial heartbeat
				const doc1 = await collection.findOne({ name: TEST_CONSTANTS.JOB_NAME });
				if (doc1?.['lastHeartbeat']) {
					heartbeatTimestamps.push(doc1['lastHeartbeat'] as Date);
				}

				// Wait for heartbeat update
				await new Promise((resolve) => setTimeout(resolve, heartbeatInterval * 2));

				// Record updated heartbeat
				const doc2 = await collection.findOne({ name: TEST_CONSTANTS.JOB_NAME });
				if (doc2?.['lastHeartbeat']) {
					heartbeatTimestamps.push(doc2['lastHeartbeat'] as Date);
				}

				// Wait for another heartbeat update
				await new Promise((resolve) => setTimeout(resolve, heartbeatInterval * 2));

				const doc3 = await collection.findOne({ name: TEST_CONSTANTS.JOB_NAME });
				if (doc3?.['lastHeartbeat']) {
					heartbeatTimestamps.push(doc3['lastHeartbeat'] as Date);
				}
			});

			await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { value: 1 });
			monque.start();

			await waitFor(async () => heartbeatTimestamps.length >= 3, { timeout: 5000 });

			// Verify heartbeats are increasing
			expect(heartbeatTimestamps.length).toBeGreaterThanOrEqual(3);
			for (let i = 1; i < heartbeatTimestamps.length; i++) {
				const prev = heartbeatTimestamps[i - 1];
				const curr = heartbeatTimestamps[i];
				if (prev && curr) {
					expect(curr.getTime()).toBeGreaterThanOrEqual(prev.getTime());
				}
			}
		});

		it('should clear lastHeartbeat when job completes', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, {
				collectionName,
				pollInterval: 100,
				heartbeatInterval: 50,
			});
			monqueInstances.push(monque);
			await monque.initialize();

			let completed = false;
			monque.on('job:complete', () => {
				completed = true;
			});

			monque.worker(TEST_CONSTANTS.JOB_NAME, async () => {
				// Quick completion
			});

			const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { value: 1 });
			monque.start();

			await waitFor(async () => completed, { timeout: 5000 });

			const collection = db.collection(collectionName);
			const doc = await collection.findOne({ _id: job._id });

			expect(doc?.['status']).toBe(JobStatus.COMPLETED);
			expect(doc?.['lastHeartbeat']).toBeUndefined();
			expect(doc?.['claimedBy']).toBeUndefined();
		});
	});

	describe('heartbeat interval configuration', () => {
		it('should use custom heartbeat interval', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const customInterval = 200;
			const monque = new Monque(db, {
				collectionName,
				pollInterval: 50,
				heartbeatInterval: customInterval,
			});
			monqueInstances.push(monque);
			await monque.initialize();

			let jobStarted = false;
			monque.worker(TEST_CONSTANTS.JOB_NAME, async () => {
				jobStarted = true;
				await new Promise((resolve) => setTimeout(resolve, 500));
			});

			await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { value: 1 });
			monque.start();

			await waitFor(async () => jobStarted, { timeout: 5000 });

			const collection = db.collection(collectionName);
			const doc = await collection.findOne({ name: TEST_CONSTANTS.JOB_NAME });

			expect(doc?.['heartbeatInterval']).toBe(customInterval);
		});

		it('should use default heartbeat interval of 30000ms', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const monque = new Monque(db, {
				collectionName,
				pollInterval: 50,
				// No heartbeatInterval specified
			});
			monqueInstances.push(monque);
			await monque.initialize();

			let jobStarted = false;
			monque.worker(TEST_CONSTANTS.JOB_NAME, async () => {
				jobStarted = true;
				await new Promise((resolve) => setTimeout(resolve, 200));
			});

			await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { value: 1 });
			monque.start();

			await waitFor(async () => jobStarted, { timeout: 5000 });

			const collection = db.collection(collectionName);
			const doc = await collection.findOne({ name: TEST_CONSTANTS.JOB_NAME });

			expect(doc?.['heartbeatInterval']).toBe(30000);
		});
	});

	describe('stale job detection using lastHeartbeat', () => {
		it('should recover jobs with stale lastHeartbeat on startup', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const lockTimeout = 500; // 500ms for faster test

			// Create a stale job (lastHeartbeat older than lockTimeout)
			const collection = db.collection(collectionName);
			const staleTime = new Date(Date.now() - lockTimeout * 2);
			const staleJob = JobFactoryHelpers.processing({
				name: TEST_CONSTANTS.JOB_NAME,
				data: { value: 'stale' },
				nextRunAt: new Date(Date.now() - 10000),
				claimedBy: 'dead-instance',
				lockedAt: staleTime,
				lastHeartbeat: staleTime,
				heartbeatInterval: 100,
				createdAt: staleTime,
				updatedAt: staleTime,
			});
			await collection.insertOne(staleJob);

			const monque = new Monque(db, {
				collectionName,
				pollInterval: 100,
				lockTimeout,
				recoverStaleJobs: true,
			});
			monqueInstances.push(monque);

			let staleRecovered = false;
			monque.on('stale:recovered', ({ count }) => {
				if (count > 0) {
					staleRecovered = true;
				}
			});

			await monque.initialize();

			// Job should be recovered to pending
			const doc = await collection.findOne({ name: TEST_CONSTANTS.JOB_NAME });
			expect(doc?.['status']).toBe(JobStatus.PENDING);
			expect(doc?.['claimedBy']).toBeUndefined();
			expect(staleRecovered).toBe(true);
		});

		it('should not recover jobs with recent lastHeartbeat', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const lockTimeout = 5000;

			// Create a job with recent heartbeat (not stale)
			const collection = db.collection(collectionName);
			const recentTime = new Date();
			const activeJob = JobFactoryHelpers.processing({
				name: TEST_CONSTANTS.JOB_NAME,
				data: { value: 'active' },
				nextRunAt: new Date(Date.now() - 10000),
				claimedBy: 'active-instance',
				lockedAt: recentTime,
				lastHeartbeat: recentTime,
				heartbeatInterval: 100,
				createdAt: recentTime,
				updatedAt: recentTime,
			});
			await collection.insertOne(activeJob);

			const monque = new Monque(db, {
				collectionName,
				pollInterval: 100,
				lockTimeout,
				recoverStaleJobs: true,
			});
			monqueInstances.push(monque);

			await monque.initialize();

			// Job should still be processing (not recovered)
			const doc = await collection.findOne({ name: TEST_CONSTANTS.JOB_NAME });
			expect(doc?.['status']).toBe(JobStatus.PROCESSING);
			expect(doc?.['claimedBy']).toBe('active-instance');
		});
	});

	describe('heartbeat cleanup on shutdown', () => {
		it('should release claimed jobs when stop() is called', async () => {
			collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
			const instanceId = 'shutdown-instance';
			const monque = new Monque(db, {
				collectionName,
				pollInterval: 50,
				heartbeatInterval: 50,
				schedulerInstanceId: instanceId,
				shutdownTimeout: 5000,
			});
			monqueInstances.push(monque);
			await monque.initialize();

			let jobStarted = false;
			let resolveJob: (() => void) | undefined;
			const jobPromise = new Promise<void>((resolve) => {
				resolveJob = resolve;
			});

			monque.worker(TEST_CONSTANTS.JOB_NAME, async () => {
				jobStarted = true;
				// Wait until we signal completion
				await jobPromise;
			});

			await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { value: 1 });
			monque.start();

			await waitFor(async () => jobStarted, { timeout: 5000 });

			// Job is now processing - verify it's claimed
			const collection = db.collection(collectionName);
			let doc = await collection.findOne({ name: TEST_CONSTANTS.JOB_NAME });
			expect(doc?.['claimedBy']).toBe(instanceId);

			// Let the job complete
			resolveJob?.();

			// Stop should wait for job to complete
			await monque.stop();

			// After stop, job should be completed and claim cleared
			doc = await collection.findOne({ name: TEST_CONSTANTS.JOB_NAME });
			expect(doc?.['status']).toBe(JobStatus.COMPLETED);
			expect(doc?.['claimedBy']).toBeUndefined();
		});
	});
});
