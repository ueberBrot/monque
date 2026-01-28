import { type Job, JobStatus } from '@monque/core';
import { PlatformTest } from '@tsed/platform-http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Worker as MonqueWorker, WorkerController } from '@/decorators';
import { MonqueService } from '@/services';

import { waitFor } from '../test-utils.js';
import { bootstrapMonque, resetMonque } from './helpers/bootstrap.js';

@WorkerController('email')
class EmailWorkers {
	public processed: string[] = [];

	@MonqueWorker('send')
	async sendEmail(job: Job<{ to: string }>) {
		this.processed.push(job.data.to);
		return { sent: true };
	}

	@MonqueWorker('welcome', { concurrency: 5 })
	async sendWelcome(job: Job<{ userId: string }>) {
		this.processed.push(`welcome:${job.data.userId}`);
		return 'welcome';
	}
}

@WorkerController()
class SystemWorkers {
	public executed = false;

	@MonqueWorker('cleanup')
	async cleanup() {
		this.executed = true;
	}
}

describe('Worker Registration Integration', () => {
	afterEach(resetMonque);

	describe('Worker Discovery & Registration', () => {
		beforeEach(async () => {
			await bootstrapMonque({
				imports: [EmailWorkers, SystemWorkers],
				connectionStrategy: 'dbFactory',
			});
		});

		it('should discover WorkerController classes', () => {
			const monqueService = PlatformTest.get<MonqueService>(MonqueService);
			expect(monqueService).toBeDefined();
		});

		it('should register namespaced workers with correct names', async () => {
			const monqueService = PlatformTest.get<MonqueService>(MonqueService);
			const job = await monqueService.enqueue('email.send', { to: 'test@example.com' });
			expect(job).toBeDefined();
			expect(job.name).toBe('email.send');
		});

		it('should register workers without namespace using plain name', async () => {
			const monqueService = PlatformTest.get<MonqueService>(MonqueService);
			const job = await monqueService.enqueue('cleanup', {});
			expect(job).toBeDefined();
			expect(job.name).toBe('cleanup');
		});

		it('should enqueue a job with namespaced name', async () => {
			const monqueService = PlatformTest.get<MonqueService>(MonqueService);
			const job = await monqueService.enqueue('email.welcome', { userId: 'user-1' });
			expect(job).toBeDefined();
			expect(job.name).toBe('email.welcome');
		});
	});

	describe('Job Processing', () => {
		beforeEach(async () => {
			await bootstrapMonque({
				imports: [EmailWorkers, SystemWorkers],
				connectionStrategy: 'dbFactory',
			});
		});

		it('should invoke correct handler method when job is processed', async () => {
			const monqueService = PlatformTest.get<MonqueService>(MonqueService);
			const emailWorkers = PlatformTest.get<EmailWorkers>(EmailWorkers);

			await monqueService.now('email.send', { to: 'test@example.com' });

			// Wait for processing
			await waitFor(() => emailWorkers.processed.includes('test@example.com'));

			expect(emailWorkers.processed).toContain('test@example.com');
		});

		it('should invoke handler for non-namespaced worker', async () => {
			const monqueService = PlatformTest.get<MonqueService>(MonqueService);
			const systemWorkers = PlatformTest.get<SystemWorkers>(SystemWorkers);

			await monqueService.now('cleanup', {});

			await waitFor(() => systemWorkers.executed);

			expect(systemWorkers.executed).toBe(true);
		});
	});

	describe('Resilience', () => {
		it('should handle max retries', async () => {
			@WorkerController('resilience')
			class ResilienceWorker {
				static failCount = 0;
				@MonqueWorker('fail')
				async fail() {
					ResilienceWorker.failCount++;
					throw new Error('Persistent failure');
				}
			}

			await bootstrapMonque({
				imports: [ResilienceWorker],
				connectionStrategy: 'dbFactory',
				monqueConfig: {
					maxRetries: 2,
					baseRetryInterval: 10,
					pollInterval: 100,
				},
			});

			const monqueService = PlatformTest.get<MonqueService>(MonqueService);
			const job = await monqueService.now('resilience.fail', {});

			await waitFor(
				async () => {
					const persistedJob = await monqueService.getJob(job._id.toString());
					return persistedJob?.status === JobStatus.FAILED;
				},
				{ timeout: 10000 },
			);

			const failedJob = await monqueService.getJob(job._id.toString());
			expect(failedJob?.status).toBe(JobStatus.FAILED);
			expect(failedJob?.failCount).toBe(2);
			expect(ResilienceWorker.failCount).toBe(2);
		});
	});

	describe('Lifecycle Integration', () => {
		it('should wait for active jobs during stop()', async () => {
			@WorkerController('lifecycle')
			class LifecycleWorker {
				static started = false;
				static completed = false;
				@MonqueWorker('long-running')
				async longRunning() {
					LifecycleWorker.started = true;
					await new Promise((resolve) => setTimeout(resolve, 500));
					LifecycleWorker.completed = true;
				}
			}

			await bootstrapMonque({
				imports: [LifecycleWorker],
				connectionStrategy: 'dbFactory',
				monqueConfig: {
					pollInterval: 100,
				},
			});

			const monqueService = PlatformTest.get<MonqueService>(MonqueService);
			await monqueService.now('lifecycle.long-running', {});

			// Wait for it to start
			await waitFor(() => LifecycleWorker.started);

			// Stop while it's running
			await monqueService.monque.stop();

			expect(LifecycleWorker.completed).toBe(true);
		});
	});
});
