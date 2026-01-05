/**
 * Tests for the getJobs() and getJob() methods of the Monque scheduler.
 *
 * These tests verify:
 * - Basic job querying functionality
 * - Filtering by name, status, and combinations
 * - Pagination with limit and skip
 * - Single job lookup by ID
 * - Error handling for uninitialized scheduler
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
} from '@test-utils/test-utils.js';
import type { Collection, Db, Document } from 'mongodb';
import { ObjectId } from 'mongodb';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { JobFactory, JobFactoryHelpers } from '@tests/factories/job.factory.js';
import { JobStatus } from '@/jobs';
import { Monque } from '@/scheduler';

/** Test-specific job names to avoid collision */
const JOB_NAMES = {
	EMAIL: 'send-email',
	REPORT: 'generate-report',
	SYNC: 'sync-data',
} as const;

describe('getJobs()', () => {
	let db: Db;
	let collectionName: string;
	let collection: Collection<Document>;
	const monqueInstances: Monque[] = [];

	beforeAll(async () => {
		db = await getTestDb('inspection-getJobs');
	});

	afterAll(async () => {
		await cleanupTestDb(db);
	});

	beforeEach(async () => {
		collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
		collection = db.collection(collectionName);
	});

	afterEach(async () => {
		await stopMonqueInstances(monqueInstances);
		if (collectionName) {
			await clearCollection(db, collectionName);
		}
	});

	describe('basic querying', () => {
		it('should return all jobs when no filter is provided', async () => {
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const seedJobs = [
				JobFactory.build({ name: JOB_NAMES.EMAIL }),
				JobFactory.build({ name: JOB_NAMES.REPORT }),
				JobFactory.build({ name: JOB_NAMES.SYNC }),
			];
			await collection.insertMany(seedJobs);

			const jobs = await monque.getJobs();

			expect(jobs).toHaveLength(3);
		});

		it('should return empty array when no jobs exist', async () => {
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const jobs = await monque.getJobs();

			expect(jobs).toHaveLength(0);
			expect(jobs).toEqual([]);
		});

		it('should return jobs ordered by nextRunAt ascending', async () => {
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const now = Date.now();
			const seedJobs = [
				JobFactory.build({
					name: JOB_NAMES.EMAIL,
					data: { order: 3 },
					nextRunAt: new Date(now + 3000),
				}),
				JobFactory.build({
					name: JOB_NAMES.EMAIL,
					data: { order: 1 },
					nextRunAt: new Date(now + 1000),
				}),
				JobFactory.build({
					name: JOB_NAMES.EMAIL,
					data: { order: 2 },
					nextRunAt: new Date(now + 2000),
				}),
			];
			await collection.insertMany(seedJobs);

			const jobs = await monque.getJobs<{ order: number }>();

			expect(jobs[0]?.data.order).toBe(1);
			expect(jobs[1]?.data.order).toBe(2);
			expect(jobs[2]?.data.order).toBe(3);
		});

		it('should return PersistedJob with _id', async () => {
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const seedJob = JobFactory.build({ name: JOB_NAMES.EMAIL });
			await collection.insertOne(seedJob);

			const jobs = await monque.getJobs();

			expect(jobs[0]?._id).toBeInstanceOf(ObjectId);
			expect(jobs[0]?.name).toBe(JOB_NAMES.EMAIL);
			expect(jobs[0]?.status).toBe(JobStatus.PENDING);
		});
	});

	describe('filter by name', () => {
		it('should filter jobs by name', async () => {
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const seedJobs = [
				JobFactory.build({ name: JOB_NAMES.EMAIL }),
				JobFactory.build({ name: JOB_NAMES.EMAIL }),
				JobFactory.build({ name: JOB_NAMES.REPORT }),
			];
			await collection.insertMany(seedJobs);

			const emailJobs = await monque.getJobs({ name: JOB_NAMES.EMAIL });

			expect(emailJobs).toHaveLength(2);
			expect(emailJobs.every((j) => j.name === JOB_NAMES.EMAIL)).toBe(true);
		});

		it('should return empty when name does not match any jobs', async () => {
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const seedJob = JobFactory.build({ name: JOB_NAMES.EMAIL });
			await collection.insertOne(seedJob);

			const jobs = await monque.getJobs({ name: 'non-existent-job' });

			expect(jobs).toHaveLength(0);
		});
	});

	describe('filter by status', () => {
		it('should filter jobs by single status', async () => {
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const pendingJob = JobFactory.build({ name: JOB_NAMES.EMAIL });
			const completedJob = JobFactoryHelpers.completed({ name: JOB_NAMES.REPORT });
			await collection.insertMany([pendingJob, completedJob]);

			const pendingJobs = await monque.getJobs({ status: JobStatus.PENDING });
			const completedJobs = await monque.getJobs({ status: JobStatus.COMPLETED });

			expect(pendingJobs).toHaveLength(1);
			expect(pendingJobs[0]?.status).toBe(JobStatus.PENDING);
			expect(completedJobs).toHaveLength(1);
			expect(completedJobs[0]?.status).toBe(JobStatus.COMPLETED);
		});

		it('should filter jobs by multiple statuses', async () => {
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const pendingJob = JobFactory.build({ name: JOB_NAMES.EMAIL });
			const completedJob = JobFactoryHelpers.completed({ name: JOB_NAMES.REPORT });
			const failedJob = JobFactoryHelpers.failed({ name: JOB_NAMES.SYNC });
			await collection.insertMany([pendingJob, completedJob, failedJob]);

			const finishedJobs = await monque.getJobs({
				status: [JobStatus.COMPLETED, JobStatus.FAILED],
			});

			expect(finishedJobs).toHaveLength(2);
			expect(finishedJobs.some((j) => j.status === JobStatus.COMPLETED)).toBe(true);
			expect(finishedJobs.some((j) => j.status === JobStatus.FAILED)).toBe(true);
		});
	});

	describe('pagination', () => {
		it('should limit results with limit option', async () => {
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const seedJobs = JobFactory.buildList(10, { name: JOB_NAMES.EMAIL });
			await collection.insertMany(seedJobs);

			const resultJobs = await monque.getJobs({ limit: 5 });

			expect(resultJobs).toHaveLength(5);
		});

		it('should skip results with skip option', async () => {
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const now = Date.now();
			const seedJobs = Array.from({ length: 5 }, (_, i) =>
				JobFactory.build({
					name: JOB_NAMES.EMAIL,
					data: { index: i },
					nextRunAt: new Date(now + i * 1000),
				}),
			);
			await collection.insertMany(seedJobs);

			const resultJobs = await monque.getJobs<{ index: number }>({ skip: 2 });

			expect(resultJobs).toHaveLength(3);
			expect(resultJobs[0]?.data.index).toBe(2);
			expect(resultJobs[1]?.data.index).toBe(3);
			expect(resultJobs[2]?.data.index).toBe(4);
		});

		it('should support pagination with limit and skip', async () => {
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const now = Date.now();
			const seedJobs = Array.from({ length: 10 }, (_, i) =>
				JobFactory.build({
					name: JOB_NAMES.EMAIL,
					data: { index: i },
					nextRunAt: new Date(now + i * 1000),
				}),
			);
			await collection.insertMany(seedJobs);

			const page1 = await monque.getJobs<{ index: number }>({ limit: 3, skip: 0 });
			const page2 = await monque.getJobs<{ index: number }>({ limit: 3, skip: 3 });
			const page3 = await monque.getJobs<{ index: number }>({ limit: 3, skip: 6 });

			expect(page1).toHaveLength(3);
			expect(page1[0]?.data.index).toBe(0);

			expect(page2).toHaveLength(3);
			expect(page2[0]?.data.index).toBe(3);

			expect(page3).toHaveLength(3);
			expect(page3[0]?.data.index).toBe(6);
		});

		it('should default limit to 100', async () => {
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const seedJobs = JobFactory.buildList(105, { name: JOB_NAMES.EMAIL });
			await collection.insertMany(seedJobs);

			const resultJobs = await monque.getJobs();

			expect(resultJobs).toHaveLength(100);
		});
	});

	describe('combined filters', () => {
		it('should combine name and status filters', async () => {
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const pendingEmail = JobFactory.build({ name: JOB_NAMES.EMAIL });
			const completedEmail = JobFactoryHelpers.completed({ name: JOB_NAMES.EMAIL });
			const pendingReport = JobFactory.build({ name: JOB_NAMES.REPORT });
			await collection.insertMany([pendingEmail, completedEmail, pendingReport]);

			const pendingEmails = await monque.getJobs({
				name: JOB_NAMES.EMAIL,
				status: JobStatus.PENDING,
			});

			expect(pendingEmails).toHaveLength(1);
			expect(pendingEmails[0]?.name).toBe(JOB_NAMES.EMAIL);
			expect(pendingEmails[0]?.status).toBe(JobStatus.PENDING);
		});

		it('should combine all filters', async () => {
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const now = Date.now();
			const emailJobs = Array.from({ length: 10 }, (_, i) =>
				JobFactory.build({
					name: JOB_NAMES.EMAIL,
					data: { index: i },
					nextRunAt: new Date(now + i * 1000),
				}),
			);
			const reportJob = JobFactory.build({ name: JOB_NAMES.REPORT });
			await collection.insertMany([...emailJobs, reportJob]);

			const jobs = await monque.getJobs<{ index: number }>({
				name: JOB_NAMES.EMAIL,
				status: JobStatus.PENDING,
				limit: 3,
				skip: 2,
			});

			expect(jobs).toHaveLength(3);
			expect(jobs[0]?.data.index).toBe(2);
			expect(jobs.every((j) => j.name === JOB_NAMES.EMAIL)).toBe(true);
		});
	});

	describe('error handling', () => {
		it('should throw when not initialized', async () => {
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);

			await expect(monque.getJobs()).rejects.toThrow('not initialized');
		});
	});
});

describe('getJob()', () => {
	let db: Db;
	let collectionName: string;
	let collection: Collection<Document>;
	const monqueInstances: Monque[] = [];

	beforeAll(async () => {
		db = await getTestDb('inspection-getJob');
	});

	afterAll(async () => {
		await cleanupTestDb(db);
	});

	beforeEach(async () => {
		collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
		collection = db.collection(collectionName);
	});

	afterEach(async () => {
		await stopMonqueInstances(monqueInstances);
		if (collectionName) {
			await clearCollection(db, collectionName);
		}
	});

	describe('basic lookup', () => {
		it('should return job by ObjectId', async () => {
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const seedJob = JobFactory.build({ name: JOB_NAMES.EMAIL });
			await collection.insertOne(seedJob);

			const job = await monque.getJob(seedJob._id);

			expect(job).not.toBeNull();
			expect(job?._id.toString()).toBe(seedJob._id.toString());
			expect(job?.name).toBe(JOB_NAMES.EMAIL);
		});

		it('should return null for non-existent job', async () => {
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const nonExistentId = new ObjectId();

			const job = await monque.getJob(nonExistentId);

			expect(job).toBeNull();
		});

		it('should return job with all fields', async () => {
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			const futureDate = new Date(Date.now() + 60000);
			const seedJob = JobFactory.build({
				name: JOB_NAMES.EMAIL,
				nextRunAt: futureDate,
				uniqueKey: 'test-unique-key',
			});
			await collection.insertOne(seedJob);

			const job = await monque.getJob(seedJob._id);

			expect(job).not.toBeNull();
			expect(job?._id).toBeInstanceOf(ObjectId);
			expect(job?.name).toBe(JOB_NAMES.EMAIL);
			expect(job?.status).toBe(JobStatus.PENDING);
			expect(job?.nextRunAt.getTime()).toBe(futureDate.getTime());
			expect(job?.uniqueKey).toBe('test-unique-key');
			expect(job?.failCount).toBe(0);
			expect(job?.createdAt).toBeInstanceOf(Date);
			expect(job?.updatedAt).toBeInstanceOf(Date);
		});
	});

	describe('type safety', () => {
		it('should preserve generic type for job data', async () => {
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);
			await monque.initialize();

			type EmailJobData = {
				to: string;
				subject: string;
				[key: string]: unknown;
			};

			const seedJob = JobFactoryHelpers.withData<EmailJobData>(
				{ to: 'test@example.com', subject: 'Hello' },
				{ name: JOB_NAMES.EMAIL },
			);
			await collection.insertOne(seedJob);

			const job = await monque.getJob<EmailJobData>(seedJob._id);

			expect(job?.data.to).toBe('test@example.com');
			expect(job?.data.subject).toBe('Hello');
		});
	});

	describe('error handling', () => {
		it('should throw when not initialized', async () => {
			const monque = new Monque(db, { collectionName });
			monqueInstances.push(monque);

			const someId = new ObjectId();

			await expect(monque.getJob(someId)).rejects.toThrow('not initialized');
		});
	});
});
