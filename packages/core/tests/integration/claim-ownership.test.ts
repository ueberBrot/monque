import {
	cleanupTestDb,
	getTestDb,
	stopMonqueInstances,
	uniqueCollectionName,
	waitFor,
} from '@test-utils/test-utils';
import type { Db } from 'mongodb';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { JobStatus, Monque } from '@/index';

describe('claim ownership', () => {
	let db: Db;
	const instances: Monque[] = [];
	beforeAll(async () => {
		db = await getTestDb('claim-ownership');
	});
	afterEach(async () => {
		await stopMonqueInstances(instances);
	});
	afterAll(async () => {
		await cleanupTestDb(db);
	});

	it.each([false, true])(
		'ignores a late result after the same instance ID reclaims a job (failure: %s)',
		async (fail) => {
			const options = {
				collectionName: uniqueCollectionName('claim'),
				schedulerInstanceId: 'reused-instance',
				workerConcurrency: 1,
				pollInterval: 20,
				safetyPollInterval: 20,
				shutdownTimeout: 1,
				maxRetries: 1,
			};
			const original = new Monque(db, options);
			const replacement = new Monque(db, { ...options, lockTimeout: 0 });
			instances.push(original, replacement);
			await original.initialize();
			const firstStarted = Promise.withResolvers<void>();
			const secondStarted = Promise.withResolvers<void>();
			const firstRelease = Promise.withResolvers<void>();
			const secondRelease = Promise.withResolvers<void>();
			const completed = vi.fn();
			const failed = vi.fn();
			original.on('job:complete', completed);
			original.on('job:fail', failed);
			original.register('work', async () => {
				firstStarted.resolve();
				await firstRelease.promise;
				if (fail) throw new Error('Late failure');
			});
			replacement.register('work', async () => {
				secondStarted.resolve();
				await secondRelease.promise;
			});
			const job = await original.enqueue('work', {});
			original.start();
			try {
				await firstStarted.promise;
				await original.stop();
				await replacement.initialize();
				replacement.start();
				await secondStarted.promise;
				firstRelease.resolve();
				await waitFor(
					async () => (await original.getQueueViewSummaries())[0]?.worker?.activeCount === 0,
				);
				expect((await replacement.getJob(job._id))?.status).toBe(JobStatus.PROCESSING);
				expect(completed).not.toHaveBeenCalled();
				expect(failed).not.toHaveBeenCalled();
				secondRelease.resolve();
				await waitFor(
					async () => (await replacement.getJob(job._id))?.status === JobStatus.COMPLETED,
				);
			} finally {
				firstRelease.resolve();
				secondRelease.resolve();
				await waitFor(
					async () => (await original.getQueueViewSummaries())[0]?.worker?.activeCount === 0,
				);
				await replacement.stop();
			}
		},
	);

	it('retains both executions when the same scheduler reclaims a recovered job', async () => {
		const collectionName = uniqueCollectionName('overlapping-claims');
		const monque = new Monque(db, {
			collectionName,
			workerConcurrency: 2,
			heartbeatInterval: 20,
			pollInterval: 20,
			safetyPollInterval: 20,
		});
		const recovery = new Monque(db, { collectionName, lockTimeout: 0 });
		instances.push(monque, recovery);
		await monque.initialize();
		const firstStarted = Promise.withResolvers<void>();
		const secondStarted = Promise.withResolvers<void>();
		const firstRelease = Promise.withResolvers<void>();
		const secondRelease = Promise.withResolvers<void>();
		let executions = 0;
		monque.register('work', async () => {
			if (++executions === 1) {
				firstStarted.resolve();
				await firstRelease.promise;
			} else {
				secondStarted.resolve();
				await secondRelease.promise;
			}
		});
		const job = await monque.enqueue('work', {});
		monque.start();
		try {
			await firstStarted.promise;
			await recovery.initialize();
			await secondStarted.promise;
			expect((await monque.getQueueViewSummaries())[0]?.worker?.activeCount).toBe(2);
			firstRelease.resolve();
			await waitFor(
				async () => (await monque.getQueueViewSummaries())[0]?.worker?.activeCount === 1,
			);
			const heartbeat = (await monque.getJob(job._id))?.lastHeartbeat;
			await waitFor(async () => {
				const current = (await monque.getJob(job._id))?.lastHeartbeat;
				return current instanceof Date && heartbeat instanceof Date && current > heartbeat;
			});
			expect((await monque.getJob(job._id))?.status).toBe(JobStatus.PROCESSING);
		} finally {
			firstRelease.resolve();
			secondRelease.resolve();
			await monque.stop();
		}
		expect((await monque.getJob(job._id))?.status).toBe(JobStatus.COMPLETED);
	});

	it('does not send heartbeats for a replacement claim with the same instance ID', async () => {
		const options = {
			collectionName: uniqueCollectionName('heartbeat-claim'),
			schedulerInstanceId: 'reused-instance',
			workerConcurrency: 1,
			pollInterval: 20,
			safetyPollInterval: 20,
		};
		const original = new Monque(db, { ...options, heartbeatInterval: 20 });
		const replacement = new Monque(db, { ...options, lockTimeout: 0, heartbeatInterval: 30_000 });
		instances.push(original, replacement);
		await original.initialize();
		const firstStarted = Promise.withResolvers<void>();
		const secondStarted = Promise.withResolvers<void>();
		const probeStarted = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		original.register('work', async () => {
			firstStarted.resolve();
			await release.promise;
		});
		replacement.register('work', async () => {
			secondStarted.resolve();
			await release.promise;
		});
		original.register('probe', async () => {
			probeStarted.resolve();
			await release.promise;
		});
		const job = await original.enqueue('work', {});
		original.start();
		try {
			await firstStarted.promise;
			await replacement.initialize();
			replacement.start();
			await secondStarted.promise;
			const heartbeat = (await replacement.getJob(job._id))?.lastHeartbeat;
			expect(heartbeat).toBeInstanceOf(Date);
			const probe = await original.enqueue('probe', {});
			await probeStarted.promise;
			const probeHeartbeat = (await original.getJob(probe._id))?.lastHeartbeat;
			await waitFor(async () => {
				const current = (await original.getJob(probe._id))?.lastHeartbeat;
				return (
					current instanceof Date && probeHeartbeat instanceof Date && current > probeHeartbeat
				);
			});
			expect((await replacement.getJob(job._id))?.lastHeartbeat).toEqual(heartbeat);
		} finally {
			release.resolve();
			await stopMonqueInstances(instances);
		}
	});
});
