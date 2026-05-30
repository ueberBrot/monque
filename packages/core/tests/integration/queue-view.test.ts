import {
	cleanupTestDb,
	getTestDb,
	stopMonqueInstances,
	uniqueCollectionName,
} from '@test-utils/test-utils';
import type { Db } from 'mongodb';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';

import { Monque } from '@/scheduler';

describe('Management APIs: Queue View Summaries', () => {
	let db: Db;
	const monqueInstances: Monque[] = [];

	beforeAll(async () => {
		db = await getTestDb('queue-view-api');
	});

	afterAll(async () => {
		await cleanupTestDb(db);
	});

	afterEach(async () => {
		await stopMonqueInstances(monqueInstances);
		monqueInstances.length = 0;
	});

	describe('getQueueViewSummaries', () => {
		test('returns an empty list when no persisted jobs or workers exist', async () => {
			const collectionName = uniqueCollectionName('queue_view_empty');
			const monque = new Monque(db, { collectionName, statsCacheTtlMs: 0 });
			monqueInstances.push(monque);
			await monque.initialize();

			await expect(monque.getQueueViewSummaries()).resolves.toEqual([]);
		});

		test('returns persisted job names sorted by name with statistics', async () => {
			const collectionName = uniqueCollectionName('queue_view_persisted');
			const monque = new Monque(db, { collectionName, statsCacheTtlMs: 0 });
			monqueInstances.push(monque);
			await monque.initialize();

			await monque.enqueue('report-daily', { reportId: 1 });
			await monque.enqueue('email-send', { emailId: 1 });
			await monque.enqueue('email-send', { emailId: 2 });

			const summaries = await monque.getQueueViewSummaries();

			expect(summaries).toMatchObject([
				{
					name: 'email-send',
					hasPersistedJobs: true,
					hasRegisteredWorker: false,
					stats: {
						pending: 2,
						processing: 0,
						completed: 0,
						failed: 0,
						cancelled: 0,
						total: 2,
					},
					worker: null,
				},
				{
					name: 'report-daily',
					hasPersistedJobs: true,
					hasRegisteredWorker: false,
					stats: {
						pending: 1,
						processing: 0,
						completed: 0,
						failed: 0,
						cancelled: 0,
						total: 1,
					},
					worker: null,
				},
			]);
		});

		test('includes historical-only, worker-only, and mixed queue views sorted by name', async () => {
			const collectionName = uniqueCollectionName('queue_view_mixed');
			const monque = new Monque(db, { collectionName, statsCacheTtlMs: 0 });
			monqueInstances.push(monque);
			await monque.initialize();

			monque.register('billing-sync', async () => undefined, { concurrency: 4 });
			monque.register('zeta-worker-only', async () => undefined, { concurrency: 2 });

			await monque.enqueue('alpha-history-only', { reportId: 1 });
			await monque.enqueue('billing-sync', { accountId: 1 });
			await monque.enqueue('billing-sync', { accountId: 2 });

			const summaries = await monque.getQueueViewSummaries();

			expect(summaries).toMatchObject([
				{
					name: 'alpha-history-only',
					hasPersistedJobs: true,
					hasRegisteredWorker: false,
					stats: {
						pending: 1,
						processing: 0,
						completed: 0,
						failed: 0,
						cancelled: 0,
						total: 1,
					},
					worker: null,
				},
				{
					name: 'billing-sync',
					hasPersistedJobs: true,
					hasRegisteredWorker: true,
					stats: {
						pending: 2,
						processing: 0,
						completed: 0,
						failed: 0,
						cancelled: 0,
						total: 2,
					},
					worker: {
						concurrency: 4,
						activeCount: 0,
					},
				},
				{
					name: 'zeta-worker-only',
					hasPersistedJobs: false,
					hasRegisteredWorker: true,
					stats: {
						pending: 0,
						processing: 0,
						completed: 0,
						failed: 0,
						cancelled: 0,
						total: 0,
					},
					worker: {
						concurrency: 2,
						activeCount: 0,
					},
				},
			]);
		});
	});
});
