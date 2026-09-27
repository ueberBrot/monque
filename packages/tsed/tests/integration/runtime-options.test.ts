import { type Job, JobStatus, MonqueError } from '@monque/core';
import { PlatformTest } from '@tsed/platform-http/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { JobController, Job as MonqueJob } from '@/decorators';
import { MonqueService } from '@/services';

import { waitFor } from '../test-utils.js';
import { bootstrapMonque, resetMonque } from './helpers/bootstrap.js';

describe('runtime options', () => {
	afterEach(resetMonque);

	it('validates and transforms payloads supplied to a decorated handler', async () => {
		const received: number[] = [];
		const schema = z.object({ count: z.string().transform(async (value) => Number(value) + 1) });
		@JobController('schema')
		class EphemeralSchemaController {
			@MonqueJob('work', { schema })
			async handler(job: Job<z.output<typeof schema>>) {
				received.push(job.data.count);
			}
		}
		await bootstrapMonque({ imports: [EphemeralSchemaController], connectionStrategy: 'db' });
		const service = PlatformTest.get<MonqueService>(MonqueService);
		const valid = await service.enqueue('schema.work', { count: '2' });
		const invalid = await service.enqueue('schema.work', { count: false });
		await waitFor(
			async () =>
				(await service.getJob(valid._id.toString()))?.status === JobStatus.COMPLETED &&
				(await service.getJob(invalid._id.toString()))?.status === JobStatus.FAILED,
		);
		expect(received).toEqual([3]);
		expect((await service.getJob(invalid._id.toString()))?.failCount).toBe(1);
		expect((await service.getJob(valid._id.toString()))?.data).toEqual({ count: '2' });
	});

	it('uses retry overrides supplied through a Job decorator', async () => {
		@JobController('retry')
		class EphemeralRetryController {
			@MonqueJob('custom', { maxRetries: 2, baseRetryInterval: 0 })
			async custom() {
				throw new Error('Unavailable');
			}

			@MonqueJob('default')
			async inherited() {
				throw new Error('Unavailable');
			}
		}
		await bootstrapMonque({
			imports: [EphemeralRetryController],
			connectionStrategy: 'db',
			monqueConfig: { maxRetries: 1 },
		});
		const service = PlatformTest.get<MonqueService>(MonqueService);
		const custom = await service.enqueue('retry.custom', {});
		const inherited = await service.enqueue('retry.default', {});
		await waitFor(
			async () =>
				(await service.getJob(custom._id.toString()))?.status === JobStatus.FAILED &&
				(await service.getJob(inherited._id.toString()))?.status === JobStatus.FAILED,
		);
		expect((await service.getJob(custom._id.toString()))?.failCount).toBe(2);
		expect((await service.getJob(inherited._id.toString()))?.failCount).toBe(1);
	});

	it('renews claims configured through Ts.ED', async () => {
		const started = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		@JobController('lease')
		class EphemeralLeaseController {
			@MonqueJob('work')
			async handler() {
				started.resolve();
				await release.promise;
			}
		}
		try {
			await bootstrapMonque({
				imports: [EphemeralLeaseController],
				connectionStrategy: 'db',
				monqueConfig: { leaseDuration: 1000, heartbeatInterval: 20 },
			});
			const service = PlatformTest.get<MonqueService>(MonqueService);
			const job = await service.enqueue('lease.work', {});
			await started.promise;
			const deadline = (await service.getJob(job._id.toString()))?.leaseExpiresAt;
			await waitFor(async () => {
				const current = (await service.getJob(job._id.toString()))?.leaseExpiresAt;
				return current instanceof Date && deadline instanceof Date && current > deadline;
			});
		} finally {
			release.resolve();
		}
	});

	it('rejects invalid scheduler configuration during bootstrap', async () => {
		await expect(
			bootstrapMonque({
				connectionStrategy: 'db',
				monqueConfig: { workerConcurrency: Number.NaN },
			}),
		).rejects.toThrow(MonqueError);
	});

	it('rejects invalid concurrency supplied through a Job decorator', async () => {
		@JobController('invalid-options')
		class EphemeralInvalidOptionsController {
			@MonqueJob('job', { concurrency: -1 })
			async handler(_job: Job) {}
		}

		await expect(
			bootstrapMonque({ imports: [EphemeralInvalidOptionsController], connectionStrategy: 'db' }),
		).rejects.toThrow('concurrency');
	});
});
