import { TEST_CONSTANTS } from '@test-utils/constants.js';
import {
	cleanupTestDb,
	getTestDb,
	stopMonqueInstances,
	uniqueCollectionName,
	waitFor,
} from '@test-utils/test-utils.js';
import type { Db } from 'mongodb';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { JobFactoryHelpers } from '@tests/factories/job.factory.js';
import { Monque } from '@/scheduler';

describe('job retention', () => {
	let db: Db;
	let collectionName: string;
	const monqueInstances: Monque[] = [];

	beforeAll(async () => {
		db = await getTestDb('retention');
	});

	afterAll(async () => {
		await cleanupTestDb(db);
	});

	afterEach(async () => {
		await stopMonqueInstances(monqueInstances);
	});

	it('should delete completed jobs older than specified retention', async () => {
		collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
		// Configure retention to clean up every 100ms, keeping completed jobs for 5000ms
		const monque = new Monque(db, {
			collectionName,
			pollInterval: 1000,
			jobRetention: {
				completed: 5000, // 5000ms retention
				interval: 100, // Check every 100ms
			},
		});
		monqueInstances.push(monque);

		const collection = db.collection(collectionName);

		const now = new Date();
		const oldDate = new Date(now.getTime() - 6000); // 6s ago (should be deleted)
		const recentDate = new Date(now.getTime() - 100); // 100ms ago (should be kept)

		// Insert old completed job
		await collection.insertOne(
			JobFactoryHelpers.completed({
				name: 'old-job',
				updatedAt: oldDate,
			}),
		);

		// Insert recent completed job
		await collection.insertOne(
			JobFactoryHelpers.completed({
				name: 'recent-job',
				updatedAt: recentDate,
			}),
		);

		await monque.initialize();
		monque.start();

		// Wait for cleanup to happen
		await waitFor(
			async () => {
				const count = await collection.countDocuments({ name: 'old-job' });
				return count === 0;
			},
			{ timeout: 2000, interval: 50 },
		);

		const oldJob = await collection.findOne({ name: 'old-job' });
		expect(oldJob).toBeNull();

		const recentJob = await collection.findOne({ name: 'recent-job' });
		expect(recentJob).not.toBeNull();
	});

	it('should delete failed jobs older than specified retention', async () => {
		collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
		const monque = new Monque(db, {
			collectionName,
			pollInterval: 1000,
			jobRetention: {
				failed: 5000, // 5000ms retention
				interval: 100, // Check every 100ms
			},
		});
		monqueInstances.push(monque);

		const collection = db.collection(collectionName);

		const now = new Date();
		const oldDate = new Date(now.getTime() - 6000);
		const recentDate = new Date(now.getTime() - 100);

		await collection.insertOne(
			JobFactoryHelpers.failed({
				name: 'old-failed-job',
				updatedAt: oldDate,
			}),
		);

		await collection.insertOne(
			JobFactoryHelpers.failed({
				name: 'recent-failed-job',
				updatedAt: recentDate,
			}),
		);

		await monque.initialize();
		monque.start();

		await waitFor(
			async () => {
				const count = await collection.countDocuments({ name: 'old-failed-job' });
				return count === 0;
			},
			{ timeout: 2000, interval: 50 },
		);

		const oldJob = await collection.findOne({ name: 'old-failed-job' });
		expect(oldJob).toBeNull();

		const recentJob = await collection.findOne({ name: 'recent-failed-job' });
		expect(recentJob).not.toBeNull();
	});

	it('should handle concurrent cleanup from two instances without data corruption', async () => {
		collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
		const retentionConfig = {
			completed: 5000,
			failed: 5000,
			interval: 100,
		};

		const monque1 = new Monque(db, {
			collectionName,
			pollInterval: 1000,
			jobRetention: retentionConfig,
		});
		const monque2 = new Monque(db, {
			collectionName,
			pollInterval: 1000,
			jobRetention: retentionConfig,
		});
		monqueInstances.push(monque1, monque2);

		const collection = db.collection(collectionName);

		const now = new Date();
		const oldDate = new Date(now.getTime() - 6000); // 6s ago — should be deleted
		const recentDate = new Date(now.getTime() - 100); // 100ms ago — should survive

		// Seed jobs for retention test
		await collection.insertMany([
			// Old completed jobs (should be deleted)
			JobFactoryHelpers.completed({ name: 'old-completed-1', updatedAt: oldDate }),
			JobFactoryHelpers.completed({ name: 'old-completed-2', updatedAt: oldDate }),
			JobFactoryHelpers.completed({ name: 'old-completed-3', updatedAt: oldDate }),
			// Old failed jobs (should be deleted)
			JobFactoryHelpers.failed({ name: 'old-failed-1', updatedAt: oldDate }),
			JobFactoryHelpers.failed({ name: 'old-failed-2', updatedAt: oldDate }),
			JobFactoryHelpers.failed({ name: 'old-failed-3', updatedAt: oldDate }),
			// Recent completed jobs (should survive)
			JobFactoryHelpers.completed({ name: 'recent-completed-1', updatedAt: recentDate }),
			JobFactoryHelpers.completed({ name: 'recent-completed-2', updatedAt: recentDate }),
			// Recent failed jobs (should survive)
			JobFactoryHelpers.failed({ name: 'recent-failed-1', updatedAt: recentDate }),
			JobFactoryHelpers.failed({ name: 'recent-failed-2', updatedAt: recentDate }),
		]);

		// Start both instances concurrently
		await monque1.initialize();
		await monque2.initialize();
		monque1.start();
		monque2.start();

		// Wait for cleanup to remove all old jobs
		await waitFor(
			async () => {
				const oldCount = await collection.countDocuments({
					name: { $regex: /^old-/ },
				});
				return oldCount === 0;
			},
			{ timeout: 5000, interval: 50 },
		);

		// Assert all 6 old jobs deleted
		const oldCount = await collection.countDocuments({ name: { $regex: /^old-/ } });
		expect(oldCount).toBe(0);

		// Assert all 4 recent jobs survive
		const recentCount = await collection.countDocuments({ name: { $regex: /^recent-/ } });
		expect(recentCount).toBe(4);

		// Assert total remaining is exactly 4 (no phantom documents)
		const totalCount = await collection.countDocuments({});
		expect(totalCount).toBe(4);

		// Verify specific recent jobs exist by name
		const recentCompleted1 = await collection.findOne({ name: 'recent-completed-1' });
		expect(recentCompleted1).not.toBeNull();

		const recentCompleted2 = await collection.findOne({ name: 'recent-completed-2' });
		expect(recentCompleted2).not.toBeNull();

		const recentFailed1 = await collection.findOne({ name: 'recent-failed-1' });
		expect(recentFailed1).not.toBeNull();

		const recentFailed2 = await collection.findOne({ name: 'recent-failed-2' });
		expect(recentFailed2).not.toBeNull();
	});

	it('should not delete jobs if retention is not configured', async () => {
		collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
		const monque = new Monque(db, {
			collectionName,
			pollInterval: 1000,
			// No jobRetention
		});
		monqueInstances.push(monque);

		const collection = db.collection(collectionName);
		const oldDate = new Date(Date.now() - 5000);

		await collection.insertOne(
			JobFactoryHelpers.completed({
				name: 'should-keep-job',
				updatedAt: oldDate,
			}),
		);

		await monque.initialize();
		monque.start();

		// Wait a bit to ensure no cleanup happens
		await new Promise((r) => setTimeout(r, 500));

		const job = await collection.findOne({ name: 'should-keep-job' });
		expect(job).not.toBeNull();
	});
});
