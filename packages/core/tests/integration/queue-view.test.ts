import {
	cleanupTestDb,
	getTestDb,
	stopMonqueInstances,
	uniqueCollectionName,
} from '@test-utils/test-utils';
import type { Db } from 'mongodb';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';

import type { QueueStats } from '@/jobs';
import { Monque } from '@/scheduler';

type QueueStatsCounts = Omit<QueueStats, 'avgProcessingDurationMs'>;

const zeroQueueStats: QueueStatsCounts = {
	pending: 0,
	processing: 0,
	completed: 0,
	failed: 0,
	cancelled: 0,
	total: 0,
};

function queueStats(overrides: Partial<QueueStatsCounts> = {}): QueueStats {
	return { ...zeroQueueStats, ...overrides };
}

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

	async function createInitializedMonque(collectionNamePrefix: string): Promise<Monque> {
		const collectionName = uniqueCollectionName(collectionNamePrefix);
		const monque = new Monque(db, { collectionName, statsCacheTtlMs: 0 });
		monqueInstances.push(monque);
		await monque.initialize();

		return monque;
	}

	describe('getQueueViewSummaries', () => {
		test('filters persisted and worker-only names with isolated caches and mutation invalidation', async () => {
			const monque = new Monque(db, {
				collectionName: uniqueCollectionName('filtered_views'),
				statsCacheTtlMs: 60_000,
			});
			monqueInstances.push(monque);
			await monque.initialize();
			const job = await monque.enqueue('alpha', {});
			await monque.enqueue('beta', {});
			monque.register('worker-only', async () => undefined);
			expect(await monque.getQueueViewSummaries()).toHaveLength(3);
			expect(await monque.getQueueViewSummaries({ name: 'alpha' })).toMatchObject([
				{
					name: 'alpha',
					hasPersistedJobs: true,
					hasRegisteredWorker: false,
					stats: { pending: 1 },
				},
			]);
			expect(await monque.getQueueViewSummaries({ name: 'beta' })).toMatchObject([
				{ name: 'beta' },
			]);
			expect(await monque.getQueueViewSummaries({ name: 'worker-only' })).toMatchObject([
				{
					name: 'worker-only',
					hasPersistedJobs: false,
					hasRegisteredWorker: true,
					stats: { total: 0 },
				},
			]);
			expect(await monque.getQueueViewSummaries({ name: 'missing' })).toEqual([]);
			await monque.cancelJob(job._id.toHexString());
			expect(await monque.getQueueViewSummaries({ name: 'alpha' })).toMatchObject([
				{ name: 'alpha', stats: { pending: 0, cancelled: 1 } },
			]);
			expect(await monque.getQueueViewSummaries()).toHaveLength(3);
		});

		test('cached counts remain isolated, workers stay fresh, and mutations invalidate snapshots', async () => {
			const monque = new Monque(db, {
				collectionName: uniqueCollectionName('cached_views'),
				statsCacheTtlMs: 60_000,
			});
			monqueInstances.push(monque);
			await monque.initialize();
			const job = await monque.enqueue('email', {});
			const views = await monque.getQueueViewSummaries();
			const first = views[0];
			if (!first) throw new Error('Expected queue');
			expect(Object.isFrozen(first.stats)).toBe(true);
			monque.register('new-worker', async () => undefined);
			expect(await monque.getQueueViewSummaries()).toMatchObject([
				{ name: 'email', stats: { pending: 1 } },
				{ name: 'new-worker', hasRegisteredWorker: true },
			]);
			await monque.getQueueStats();
			await monque.cancelJob(job._id.toHexString());
			expect(await monque.getQueueViewSummaries()).toMatchObject([
				{ name: 'email', stats: { pending: 0, cancelled: 1 } },
				{ name: 'new-worker' },
			]);
			expect(await monque.getQueueStats()).toMatchObject({ pending: 0, cancelled: 1 });
		});

		test('returns an empty list when no persisted jobs or workers exist', async () => {
			const monque = await createInitializedMonque('queue_view_empty');

			await expect(monque.getQueueViewSummaries()).resolves.toEqual([]);
		});

		test('returns persisted job names sorted by name with statistics', async () => {
			const monque = await createInitializedMonque('queue_view_persisted');

			await monque.enqueue('report-daily', { reportId: 1 });
			await monque.enqueue('email-send', { emailId: 1 });
			await monque.enqueue('email-send', { emailId: 2 });

			const summaries = await monque.getQueueViewSummaries();

			expect(summaries).toMatchObject([
				{
					name: 'email-send',
					hasPersistedJobs: true,
					hasRegisteredWorker: false,
					stats: queueStats({ pending: 2, total: 2 }),
					worker: null,
				},
				{
					name: 'report-daily',
					hasPersistedJobs: true,
					hasRegisteredWorker: false,
					stats: queueStats({ pending: 1, total: 1 }),
					worker: null,
				},
			]);
		});

		test('includes historical-only, worker-only, and mixed queue views sorted by name', async () => {
			const monque = await createInitializedMonque('queue_view_mixed');

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
					stats: queueStats({ pending: 1, total: 1 }),
					worker: null,
				},
				{
					name: 'billing-sync',
					hasPersistedJobs: true,
					hasRegisteredWorker: true,
					stats: queueStats({ pending: 2, total: 2 }),
					worker: {
						concurrency: 4,
						activeCount: 0,
					},
				},
				{
					name: 'zeta-worker-only',
					hasPersistedJobs: false,
					hasRegisteredWorker: true,
					stats: queueStats(),
					worker: {
						concurrency: 2,
						activeCount: 0,
					},
				},
			]);
		});
	});
});
