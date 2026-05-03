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
	});
});
