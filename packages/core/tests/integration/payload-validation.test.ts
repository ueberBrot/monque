import type { StandardSchemaV1 } from '@standard-schema/spec';
import {
	cleanupTestDb,
	getTestDb,
	stopMonqueInstances,
	uniqueCollectionName,
	waitFor,
} from '@test-utils/test-utils';
import type { Db } from 'mongodb';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { JobStatus, Monque, PayloadValidationError } from '@/index';

describe('payload validation', () => {
	let db: Db;
	const instances: Monque[] = [];
	beforeAll(async () => {
		db = await getTestDb('payload-validation');
	});
	afterEach(async () => {
		await stopMonqueInstances(instances);
	});
	afterAll(async () => {
		await cleanupTestDb(db);
	});

	it('fails invalid persisted input without invoking the handler or retrying', async () => {
		const monque = new Monque(db, {
			collectionName: uniqueCollectionName('validation'),
			maxRetries: 10,
		});
		instances.push(monque);
		await monque.initialize();
		const job = await monque.enqueue('send', { email: 'invalid' });
		const handler = vi.fn(async () => {});
		const options = { schema: z.object({ email: z.email() }), concurrency: 1 };
		const failures: Error[] = [];
		monque.on('job:fail', ({ error }) => failures.push(error));
		monque.register('send', handler, options);
		monque.start();
		await waitFor(async () => {
			const current = await monque.getJob(job._id);
			return current?.status === JobStatus.FAILED || current?.status === JobStatus.COMPLETED;
		});
		await monque.stop();
		expect(await monque.getJob(job._id)).toMatchObject({ status: JobStatus.FAILED, failCount: 1 });
		expect(handler).not.toHaveBeenCalled();
		expect(failures[0]).toBeInstanceOf(PayloadValidationError);
		if (failures[0] instanceof PayloadValidationError) {
			expect(failures[0].issues[0]?.path).toEqual(['email']);
		}
	});

	it('passes asynchronous schema output to each attempt while retaining stored input', async () => {
		const monque = new Monque(db, {
			collectionName: uniqueCollectionName('transform'),
			baseRetryInterval: 0,
			pollInterval: 20,
			safetyPollInterval: 20,
		});
		instances.push(monque);
		await monque.initialize();
		const received: number[] = [];
		const schema = z.object({ count: z.string().transform(async (value) => Number(value) + 1) });
		monque.register(
			'work',
			async (job) => {
				received.push(job.data.count);
				if (received.length === 1) throw new Error('Try again');
			},
			{ schema },
		);
		const job = await monque.enqueue('work', { count: '2' });
		monque.start();
		await waitFor(async () => (await monque.getJob(job._id))?.status === JobStatus.COMPLETED);
		expect(received).toEqual([3, 3]);
		expect(await monque.getJob(job._id)).toMatchObject({ data: { count: '2' }, failCount: 1 });
	});

	it('retries unexpected validator exceptions using the worker policy', async () => {
		const monque = new Monque(db, {
			collectionName: uniqueCollectionName('validator-error'),
			pollInterval: 20,
			safetyPollInterval: 20,
		});
		instances.push(monque);
		await monque.initialize();
		let attempts = 0;
		const schema: StandardSchemaV1 = {
			'~standard': {
				version: 1,
				vendor: 'runtime-test',
				validate: async (value) => {
					if (++attempts === 1) throw new Error('Validation service unavailable');
					return { value };
				},
			},
		};
		const handler = vi.fn(async () => {});
		monque.register('work', handler, { schema, maxRetries: 2, baseRetryInterval: 0 });
		const job = await monque.enqueue('work', 'input');
		monque.start();
		await waitFor(async () => (await monque.getJob(job._id))?.status === JobStatus.COMPLETED);
		expect(handler).toHaveBeenCalledOnce();
		expect((await monque.getJob(job._id))?.failCount).toBe(1);
	});
});
