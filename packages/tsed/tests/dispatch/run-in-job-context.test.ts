import type { Job } from '@monque/core';
import { JobFactory } from '@test-utils/factories/job.factory.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runInJobContext } from '@/dispatch';

describe('runInJobContext', () => {
	let mockJob: Job<{ value: string }>;

	beforeEach(() => {
		mockJob = JobFactory.build({
			name: 'test-job',
			data: { value: 'test-data' },
		}) as Job<{ value: string }>;
	});

	it('should use job _id as context ID when available', async () => {
		const jobWithId = JobFactory.build({
			name: 'test-job',
			data: { value: 'test' },
		}) as Job<{ value: string }>;

		expect(jobWithId._id).toBeDefined();

		const workFn = vi.fn().mockResolvedValue(undefined);
		await runInJobContext(jobWithId, workFn);

		expect(workFn).toHaveBeenCalledTimes(1);
	});

	it('should set MONQUE_JOB in context', async () => {
		let capturedJob: Job<{ value: string }> | undefined;

		await runInJobContext(mockJob, async () => {
			capturedJob = mockJob;
		});

		expect(capturedJob).toBe(mockJob);
	});

	it('should execute work function', async () => {
		const workFn = vi.fn().mockResolvedValue(undefined);

		await runInJobContext(mockJob, workFn);

		expect(workFn).toHaveBeenCalledTimes(1);
	});

	it('should handle job without _id gracefully', async () => {
		const jobWithoutId = {
			name: 'test-job',
			data: { value: 'test' },
			status: 'pending',
		} as Job<{ value: string }>;

		const workFn = vi.fn().mockResolvedValue(undefined);

		await runInJobContext(jobWithoutId, workFn);

		expect(workFn).toHaveBeenCalledTimes(1);
	});

	it('should propagate errors from work function', async () => {
		const error = new Error('Work function failed');

		await expect(
			runInJobContext(mockJob, async () => {
				throw error;
			}),
		).rejects.toThrow('Work function failed');
	});

	it('should destroy context even when work function throws', async () => {
		await expect(
			runInJobContext(mockJob, async () => {
				throw new Error('Simulated error');
			}),
		).rejects.toThrow();
	});

	it('should handle jobs with different data types', async () => {
		const jobWithNumber = JobFactory.build({
			name: 'number-job',
			data: 42,
		}) as Job<number>;

		const workFn = vi.fn().mockResolvedValue(undefined);

		await runInJobContext(jobWithNumber, workFn);

		expect(workFn).toHaveBeenCalledTimes(1);
	});
});
