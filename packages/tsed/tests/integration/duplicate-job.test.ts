import { type Job, JobStatus, WorkerRegistrationError } from '@monque/core';
import { PlatformTest } from '@tsed/platform-http/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { JobController, Job as MonqueJob } from '@/decorators';
import { MonqueService } from '@/services';

import { bootstrapMonque, getTestDb, resetMonque } from './helpers/bootstrap.js';

describe('Duplicate Validation & Idempotency', () => {
	afterEach(resetMonque);

	describe('Job Registration', () => {
		it('should throw error on duplicate job names', async () => {
			@JobController('duplicate')
			class EphemeralDuplicateController1 {
				@MonqueJob('job')
				async handler(_job: Job) {}
			}

			@JobController('duplicate')
			class EphemeralDuplicateController2 {
				@MonqueJob('job')
				async handler(_job: Job) {}
			}

			await expect(
				bootstrapMonque({
					imports: [EphemeralDuplicateController1, EphemeralDuplicateController2],
					connectionStrategy: 'db',
				}),
			).rejects.toThrow(WorkerRegistrationError);

			await expect(
				bootstrapMonque({
					imports: [EphemeralDuplicateController1, EphemeralDuplicateController2],
					connectionStrategy: 'db',
				}),
			).rejects.toThrow(/Duplicate job registration detected/);
		});
	});

	describe('Job Idempotency', () => {
		it('should not enqueue duplicate jobs when uniqueKey is provided', async () => {
			@JobController('idempotent')
			class EphemeralIdempotentController {
				@MonqueJob('job')
				async handler(_job: Job) {}
			}

			await bootstrapMonque({
				imports: [EphemeralIdempotentController],
				connectionStrategy: 'dbFactory',
			});

			const monqueService = PlatformTest.get<MonqueService>(MonqueService);
			const db = getTestDb();
			const collection = db.collection('monque_jobs');

			// First Enqueue
			const job1 = await monqueService.enqueue(
				'idempotent.job',
				{ foo: 'bar' },
				{ uniqueKey: 'unique-1' },
			);
			expect(job1).toBeDefined();

			// Second Enqueue (Duplicate)
			const job2 = await monqueService.enqueue(
				'idempotent.job',
				{ foo: 'baz' },
				{ uniqueKey: 'unique-1' },
			);

			// Should return the EXISTING job (job1)
			expect(job2._id.toString()).toBe(job1._id.toString());

			// Verify only 1 document exists
			const stats = await monqueService.getQueueStats({ name: 'idempotent.job' });
			expect(stats.total).toBe(1);

			// Mark the job as completed
			await collection.updateOne({ _id: job1._id }, { $set: { status: JobStatus.COMPLETED } });

			// Third Enqueue (Same uniqueKey, but previous job is completed)
			const job3 = await monqueService.enqueue(
				'idempotent.job',
				{ foo: 'new' },
				{ uniqueKey: 'unique-1' },
			);

			// Should return a NEW job (different ID)
			expect(job3._id.toString()).not.toBe(job1._id.toString());

			// Verify now 2 documents exist
			const newStats = await monqueService.getQueueStats({ name: 'idempotent.job' });
			expect(newStats.total).toBe(2);
		});
	});
});
