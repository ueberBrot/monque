/**
 * Tests for stale job recovery in the Monque scheduler.
 *
 * These tests verify:
 * - Stale jobs (processing > lockTimeout) are detected
 * - Stale jobs are recovered to pending status on startup
 * - recoverStaleJobs=false option is respected
 *
 * @see {@link ../src/monque.ts}
 */

import type { Db } from 'mongodb';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { JobFactoryHelpers } from '@tests/factories/job.factory.js';
import { TEST_CONSTANTS } from '@tests/setup/constants.js';
import {
	cleanupTestDb,
	clearCollection,
	findJobByQuery,
	getTestDb,
	stopMonqueInstances,
	uniqueCollectionName,
} from '@tests/setup/test-utils.js';
import { Monque } from '@/monque.js';
import { JobStatus } from '@/types.js';

describe('Stale Job Recovery', () => {
	let db: Db;
	let collectionName: string;
	let monque: Monque;
	const monqueInstances: Monque[] = [];

	beforeAll(async () => {
		db = await getTestDb('stale-recovery');
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

	it('should recover stale jobs on startup when recoverStaleJobs is true (default)', async () => {
		collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
		const collection = db.collection(collectionName);

		// Insert a stale job manually
		const staleTime = new Date(Date.now() - 30 * 60 * 1000 - 1000); // 30m 1s ago
		await collection.insertOne(
			JobFactoryHelpers.processing({
				name: TEST_CONSTANTS.JOB_NAME,
				data: { id: 1 },
				nextRunAt: staleTime,
				lockedAt: staleTime,
				createdAt: staleTime,
				updatedAt: staleTime,
			}),
		);

		// Insert a fresh processing job (not stale)
		const freshTime = new Date();
		await collection.insertOne(
			JobFactoryHelpers.processing({
				name: TEST_CONSTANTS.JOB_NAME,
				data: { id: 2 },
				nextRunAt: freshTime,
				lockedAt: freshTime,
				createdAt: freshTime,
				updatedAt: freshTime,
			}),
		);

		// Initialize Monque (should trigger recovery)
		monque = new Monque(db, {
			collectionName,
			lockTimeout: 30 * 60 * 1000, // 30 minutes
		});
		monqueInstances.push(monque);
		await monque.initialize();

		// Check jobs
		const staleJob = await findJobByQuery<{ id: number }>(collection, { 'data.id': 1 });
		const freshJob = await findJobByQuery<{ id: number }>(collection, { 'data.id': 2 });

		// Stale job should be reset to pending
		expect(staleJob).not.toBeNull();
		expect(staleJob?.status).toBe(JobStatus.PENDING);
		expect(staleJob?.lockedAt).toBeUndefined();

		// Fresh job should remain processing
		expect(freshJob).not.toBeNull();
		expect(freshJob?.status).toBe(JobStatus.PROCESSING);
		expect(freshJob?.lockedAt).not.toBeNull();
	});

	it('should not recover stale jobs when recoverStaleJobs is false', async () => {
		collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
		const collection = db.collection(collectionName);

		// Insert a stale job manually
		const staleTime = new Date(Date.now() - 30 * 60 * 1000 - 1000); // 30m 1s ago
		await collection.insertOne(
			JobFactoryHelpers.processing({
				name: TEST_CONSTANTS.JOB_NAME,
				data: { id: 1 },
				nextRunAt: staleTime,
				lockedAt: staleTime,
				createdAt: staleTime,
				updatedAt: staleTime,
			}),
		);

		// Initialize Monque with recovery disabled
		monque = new Monque(db, {
			collectionName,
			lockTimeout: 30 * 60 * 1000,
			recoverStaleJobs: false,
		});
		monqueInstances.push(monque);
		await monque.initialize();

		// Check job
		const staleJob = await findJobByQuery<{ id: number }>(collection, { 'data.id': 1 });

		// Stale job should remain processing
		expect(staleJob).not.toBeNull();
		expect(staleJob?.status).toBe(JobStatus.PROCESSING);
		expect(staleJob?.lockedAt).not.toBeNull();
	});

	it('should respect custom lockTimeout configuration', async () => {
		collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
		const collection = db.collection(collectionName);

		const customTimeout = 10000; // 10 seconds

		// Insert a job that is stale according to custom timeout
		const staleTime = new Date(Date.now() - customTimeout - 1000);
		await collection.insertOne(
			JobFactoryHelpers.processing({
				name: TEST_CONSTANTS.JOB_NAME,
				data: { id: 1 },
				nextRunAt: staleTime,
				lockedAt: staleTime,
				createdAt: staleTime,
				updatedAt: staleTime,
			}),
		);

		// Insert a job that is 5s old (not stale with 10s timeout)
		const notStaleTime = new Date(Date.now() - 5000);
		await collection.insertOne(
			JobFactoryHelpers.processing({
				name: TEST_CONSTANTS.JOB_NAME,
				data: { id: 2 },
				nextRunAt: notStaleTime,
				lockedAt: notStaleTime,
				createdAt: notStaleTime,
				updatedAt: notStaleTime,
			}),
		);

		// Initialize Monque with custom timeout
		monque = new Monque(db, {
			collectionName,
			lockTimeout: customTimeout,
		});
		monqueInstances.push(monque);
		await monque.initialize();

		// Check jobs
		const staleJob = await findJobByQuery<{ id: number }>(collection, { 'data.id': 1 });
		const notStaleJob = await findJobByQuery<{ id: number }>(collection, { 'data.id': 2 });

		// Stale job should be reset
		expect(staleJob?.status).toBe(JobStatus.PENDING);

		// Not stale job should remain processing
		expect(notStaleJob?.status).toBe(JobStatus.PROCESSING);
	});
});
