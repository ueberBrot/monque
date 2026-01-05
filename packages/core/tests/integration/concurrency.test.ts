/**
 * Integration tests for concurrency and race conditions.
 *
 * These tests verify:
 * - SC-006: Multiple scheduler instances can process jobs concurrently without duplicate processing
 * - High volume job processing with multiple workers
 *
 * @see {@link ../../src/scheduler/monque.ts}
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

import { type Job, JobStatus } from '@/jobs';
import { Monque } from '@/scheduler';

describe('Concurrency & Scalability', () => {
	let db: Db;
	let collectionName: string;
	const monqueInstances: Monque[] = [];

	beforeAll(async () => {
		db = await getTestDb('concurrency');
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

	it('should process 100 jobs with 3 scheduler instances without duplicates', async () => {
		collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
		const jobCount = 100;
		const instanceCount = 3;

		// Create multiple Monque instances sharing the same collection
		for (let i = 0; i < instanceCount; i++) {
			const monque = new Monque(db, {
				collectionName,
				pollInterval: 50, // Fast polling for test
				defaultConcurrency: 5,
			});
			monqueInstances.push(monque);
			await monque.initialize();
		}

		// Track processed jobs
		const processedJobs = new Set<number>();
		const duplicateJobs = new Set<number>();
		const processingErrors: Error[] = [];

		// Define handler that tracks execution
		const handler = async (job: Job<{ id: number }>) => {
			const id = job.data.id;
			if (processedJobs.has(id)) {
				duplicateJobs.add(id);
			}
			processedJobs.add(id);
			// Simulate some work
			await new Promise((resolve) => setTimeout(resolve, 10));
		};

		// Register worker on all instances
		for (const monque of monqueInstances) {
			monque.worker(TEST_CONSTANTS.JOB_NAME, handler);
			monque.on('job:error', (payload) => processingErrors.push(payload.error));
		}

		// Enqueue jobs using the first instance
		const firstInstance = monqueInstances[0];
		if (!firstInstance) {
			throw new Error('No Monque instance available');
		}
		const enqueuePromises = [];
		for (let i = 0; i < jobCount; i++) {
			enqueuePromises.push(firstInstance.enqueue(TEST_CONSTANTS.JOB_NAME, { id: i }));
		}
		await Promise.all(enqueuePromises);

		// Start all instances
		for (const m of monqueInstances) {
			m.start();
		}

		// Wait for all jobs to be processed
		await waitFor(async () => processedJobs.size === jobCount, {
			timeout: 30000,
		});

		// Verify results
		expect(processedJobs.size).toBe(jobCount);
		expect(duplicateJobs.size).toBe(0);
		expect(processingErrors).toHaveLength(0);

		// Verify in DB that all are completed
		await waitFor(
			async () => {
				const count = await db
					.collection(collectionName)
					.countDocuments({ status: JobStatus.COMPLETED });
				return count === jobCount;
			},
			{ timeout: 10000 },
		);

		const count = await db
			.collection(collectionName)
			.countDocuments({ status: JobStatus.COMPLETED });
		expect(count).toBe(jobCount);
	});
});
