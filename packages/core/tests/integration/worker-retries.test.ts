import {
	cleanupTestDb,
	getTestDb,
	stopMonqueInstances,
	uniqueCollectionName,
	waitFor,
} from '@test-utils/test-utils';
import type { Db } from 'mongodb';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { JobStatus, Monque } from '@/index';

describe('worker retry options', () => {
	let db: Db;
	const instances: Monque[] = [];
	beforeAll(async () => {
		db = await getTestDb('worker-retries');
	});
	afterEach(async () => {
		await stopMonqueInstances(instances);
	});
	afterAll(async () => {
		await cleanupTestDb(db);
	});

	it('applies independent failure limits while other workers inherit defaults', async () => {
		const monque = new Monque(db, {
			collectionName: uniqueCollectionName('retry-options'),
			maxRetries: 1,
			baseRetryInterval: 0,
			pollInterval: 20,
			safetyPollInterval: 20,
		});
		instances.push(monque);
		await monque.initialize();
		const fail = async () => {
			throw new Error('Unavailable');
		};
		const customOptions = { maxRetries: 2, concurrency: 1 };
		monque.register('custom', fail, customOptions);
		monque.register('default', fail);
		const custom = await monque.enqueue('custom', {});
		const inherited = await monque.enqueue('default', {});
		monque.start();
		await waitFor(
			async () =>
				(await monque.getJob(custom._id))?.status === JobStatus.FAILED &&
				(await monque.getJob(inherited._id))?.status === JobStatus.FAILED,
		);
		expect((await monque.getJob(custom._id))?.failCount).toBe(2);
		expect((await monque.getJob(inherited._id))?.failCount).toBe(1);
	});

	it.each([
		{ options: { baseRetryInterval: 1000 }, min: 1500, max: 2500 },
		{ options: { maxBackoffDelay: 1000 }, min: 750, max: 1000 },
	])('uses worker backoff settings $options', async ({ options, min, max }) => {
		const monque = new Monque(db, {
			collectionName: uniqueCollectionName('backoff-options'),
			baseRetryInterval: 20_000,
		});
		instances.push(monque);
		await monque.initialize();
		monque.register(
			'work',
			async () => {
				throw new Error('Unavailable');
			},
			options,
		);
		const failure = Promise.withResolvers<{ nextRunAt: Date; updatedAt: Date }>();
		monque.once('job:fail', ({ job }) => failure.resolve(job));
		await monque.enqueue('work', {});
		monque.start();
		const job = await failure.promise;
		await monque.stop();
		const delay = job.nextRunAt.getTime() - job.updatedAt.getTime();
		expect(delay).toBeGreaterThanOrEqual(min);
		expect(delay).toBeLessThanOrEqual(max + 50);
	});

	it('keeps the retry policy of an execution when its worker is replaced', async () => {
		const monque = new Monque(db, {
			collectionName: uniqueCollectionName('retry-replacement'),
			baseRetryInterval: 0,
			pollInterval: 20,
			safetyPollInterval: 20,
		});
		instances.push(monque);
		await monque.initialize();
		const started = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		monque.register(
			'work',
			async () => {
				started.resolve();
				await release.promise;
				throw new Error('Original failure');
			},
			{ maxRetries: 1 },
		);
		const job = await monque.enqueue('work', {});
		monque.start();
		try {
			await started.promise;
			monque.register(
				'work',
				async () => {
					throw new Error('Replacement failure');
				},
				{
					replace: true,
					maxRetries: 5,
				},
			);
			release.resolve();
			await waitFor(async () => (await monque.getJob(job._id))?.status === JobStatus.FAILED);
			expect(await monque.getJob(job._id)).toMatchObject({
				failCount: 1,
				failReason: 'Original failure',
			});
		} finally {
			release.resolve();
		}
	});
});
