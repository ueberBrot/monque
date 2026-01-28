/**
 * Integration tests for producer-only mode (disableJobProcessing).
 *
 * Tests that instances with disableJobProcessing: true can enqueue jobs
 * but don't process them.
 */

import { type Job, JobStatus } from '@monque/core';
import { PlatformTest } from '@tsed/platform-http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { JobController, Job as MonqueJob } from '@/decorators';
import { MonqueService } from '@/services';

import { waitFor } from '../test-utils.js';
import { bootstrapMonque, getTestDb, resetMonque } from './helpers/bootstrap.js';

// Job controller that tracks if it was ever called
@JobController('producer-test')
class ProducerTestController {
	static processed = false;
	static processedCount = 0;

	@MonqueJob('job')
	async handler(_job: Job) {
		ProducerTestController.processed = true;
		ProducerTestController.processedCount++;
	}
}

describe('Producer-only Mode (disableJobProcessing)', () => {
	afterEach(resetMonque);

	describe('disableJobProcessing: true', () => {
		beforeEach(async () => {
			ProducerTestController.processed = false;
			ProducerTestController.processedCount = 0;

			await bootstrapMonque({
				imports: [ProducerTestController],
				connectionStrategy: 'db',
				monqueConfig: {
					disableJobProcessing: true,
				},
			});
		});

		it('should allow enqueuing jobs', async () => {
			const service = PlatformTest.get<MonqueService>(MonqueService);

			const job = await service.enqueue('producer-test.job', { test: true });

			expect(job).toBeDefined();
			expect(job._id).toBeDefined();
			expect(job.name).toBe('producer-test.job');
		});

		it('should not process jobs even with jobs defined', async () => {
			const service = PlatformTest.get<MonqueService>(MonqueService);

			await service.enqueue('producer-test.job', { test: true });

			// Wait a bit to ensure job would have been processed if running
			await new Promise((resolve) => setTimeout(resolve, 500));

			// Job should NOT have been processed
			expect(ProducerTestController.processed).toBe(false);
			expect(ProducerTestController.processedCount).toBe(0);
		});

		it('should leave jobs in pending status', async () => {
			const service = PlatformTest.get<MonqueService>(MonqueService);
			const db = getTestDb();

			await service.enqueue('producer-test.job', { test: true });

			// Wait a bit
			await new Promise((resolve) => setTimeout(resolve, 200));

			// Check job status in database
			const job = await db.collection('monque_jobs').findOne({ name: 'producer-test.job' });

			expect(job).toBeDefined();
			expect(job?.['status']).toBe(JobStatus.PENDING);
		});

		it('should report isHealthy as false', async () => {
			const service = PlatformTest.get<MonqueService>(MonqueService);

			// isHealthy should be false since scheduler is not running
			expect(service.isHealthy()).toBe(false);
		});
	});

	describe('disableJobProcessing: false (default)', () => {
		beforeEach(async () => {
			ProducerTestController.processed = false;
			ProducerTestController.processedCount = 0;

			await bootstrapMonque({
				imports: [ProducerTestController],
				connectionStrategy: 'db',
				// disableJobProcessing defaults to false
			});
		});

		it('should process jobs normally', async () => {
			const service = PlatformTest.get<MonqueService>(MonqueService);

			await service.enqueue('producer-test.job', { test: true });

			await waitFor(() => ProducerTestController.processed, { timeout: 5000 });

			expect(ProducerTestController.processed).toBe(true);
		});

		it('should report isHealthy as true', async () => {
			const service = PlatformTest.get<MonqueService>(MonqueService);

			expect(service.isHealthy()).toBe(true);
		});
	});
});
