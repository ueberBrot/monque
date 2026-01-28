import { type Job, JobStatus } from '@monque/core';
import { PlatformTest } from '@tsed/platform-http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Worker, WorkerController } from '@/decorators';
import { MonqueService } from '@/services';

import { waitFor } from '../test-utils.js';
import { bootstrapMonque, resetMonque } from './helpers/bootstrap.js';

@WorkerController('execution')
class ExecutionController {
	static processed: string[] = [];
	static failCount = 0;

	@Worker('success')
	async success(job: Job) {
		if (job._id) ExecutionController.processed.push(job._id.toString());
	}

	@Worker('fail-once')
	async failOnce(job: Job) {
		if (ExecutionController.failCount === 0) {
			ExecutionController.failCount++;
			throw new Error('Intentional failure');
		}
		if (job._id) ExecutionController.processed.push(job._id.toString());
	}
}

describe('Job Execution Flow', () => {
	afterEach(resetMonque);

	beforeEach(() => {
		ExecutionController.processed = [];
		ExecutionController.failCount = 0;
	});

	it('should process a job successfully (Pending -> Processing -> Completed)', async () => {
		await bootstrapMonque({
			imports: [ExecutionController],
			connectionStrategy: 'dbFactory',
		});

		const monqueService = PlatformTest.get<MonqueService>(MonqueService);

		const job = await monqueService.enqueue('execution.success', {});

		// Check Pending
		const pendingJob = await monqueService.getJob(job._id.toString());
		expect(pendingJob).not.toBeNull();
		expect(pendingJob?.status).toBe(JobStatus.PENDING);

		// Wait for completion via DB polling
		await waitFor(async () => {
			const persistedJob = await monqueService.getJob(job._id.toString());
			return persistedJob?.status === JobStatus.COMPLETED && persistedJob?.updatedAt !== undefined;
		});

		// Check Completed
		const completedJob = await monqueService.getJob(job._id.toString());
		expect(completedJob).not.toBeNull();
		expect(completedJob?.status).toBe(JobStatus.COMPLETED);
		expect(completedJob?.updatedAt).toBeDefined();
	});

	it('should retry failed jobs (Pending -> Processing -> Failed -> Retry -> Completed)', async () => {
		await bootstrapMonque({
			imports: [ExecutionController],
			connectionStrategy: 'dbFactory',
		});
		const monqueService = PlatformTest.get<MonqueService>(MonqueService);

		const job = await monqueService.enqueue('execution.fail-once', {});

		// Wait for first failure (failCount incremented)
		await waitFor(() => ExecutionController.failCount === 1);

		// At this point, the job should have failed and been rescheduled (backoff).
		// We wait for it to be processed again and complete.
		await waitFor(
			async () => {
				const persistedJob = await monqueService.getJob(job._id.toString());
				return persistedJob?.status === JobStatus.COMPLETED;
			},
			{
				timeout: 10000,
			},
		);

		const completedJob = await monqueService.getJob(job._id.toString());
		expect(completedJob).not.toBeNull();
		expect(completedJob?.status).toBe(JobStatus.COMPLETED);
		// failedCount might be 1 (failed once)
		expect(completedJob?.failCount).toBe(1);
	});
});
