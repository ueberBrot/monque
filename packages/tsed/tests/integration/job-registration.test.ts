import { type Job, JobStatus } from '@monque/core';
import { PlatformTest } from '@tsed/platform-http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { JobController, Job as MonqueJob } from '@/decorators';
import { MonqueService } from '@/services';

import { waitFor } from '../test-utils.js';
import { bootstrapMonque, resetMonque } from './helpers/bootstrap.js';

@JobController('email')
class EmailJobs {
	public processed: string[] = [];

	@MonqueJob('send')
	async sendEmail(job: Job<{ to: string }>) {
		this.processed.push(job.data.to);
		return { sent: true };
	}

	@MonqueJob('welcome', { concurrency: 5 })
	async sendWelcome(job: Job<{ userId: string }>) {
		this.processed.push(`welcome:${job.data.userId}`);
		return 'welcome';
	}
}

@JobController()
class SystemJobs {
	public executed = false;

	@MonqueJob('cleanup')
	async cleanup() {
		this.executed = true;
	}
}

describe('Job Registration Integration', () => {
	afterEach(resetMonque);

	describe('Job Discovery & Registration', () => {
		beforeEach(async () => {
			await bootstrapMonque({
				imports: [EmailJobs, SystemJobs],
				connectionStrategy: 'dbFactory',
			});
		});

		it('should discover JobController classes', () => {
			const monqueService = PlatformTest.get<MonqueService>(MonqueService);
			expect(monqueService).toBeDefined();
		});

		it('should register namespaced jobs with correct names', async () => {
			const monqueService = PlatformTest.get<MonqueService>(MonqueService);
			const job = await monqueService.enqueue('email.send', { to: 'test@example.com' });
			expect(job).toBeDefined();
			expect(job.name).toBe('email.send');
		});

		it('should register jobs without namespace using plain name', async () => {
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
				imports: [EmailJobs, SystemJobs],
				connectionStrategy: 'dbFactory',
			});
		});

		it('should invoke correct handler method when job is processed', async () => {
			const monqueService = PlatformTest.get<MonqueService>(MonqueService);
			const emailJobs = PlatformTest.get<EmailJobs>(EmailJobs);

			await monqueService.now('email.send', { to: 'test@example.com' });

			// Wait for processing
			await waitFor(() => emailJobs.processed.includes('test@example.com'));

			expect(emailJobs.processed).toContain('test@example.com');
		});

		it('should invoke handler for non-namespaced job', async () => {
			const monqueService = PlatformTest.get<MonqueService>(MonqueService);
			const systemJobs = PlatformTest.get<SystemJobs>(SystemJobs);

			await monqueService.now('cleanup', {});

			await waitFor(() => systemJobs.executed);

			expect(systemJobs.executed).toBe(true);
		});
	});

	describe('Resilience', () => {
		it('should handle max retries', async () => {
			@JobController('resilience')
			class ResilienceJob {
				static failCount = 0;
				@MonqueJob('fail')
				async fail() {
					ResilienceJob.failCount++;
					throw new Error('Persistent failure');
				}
			}

			await bootstrapMonque({
				imports: [ResilienceJob],
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
			expect(ResilienceJob.failCount).toBe(2);
		});
	});

	describe('Lifecycle Integration', () => {
		it('should wait for active jobs during stop()', async () => {
			@JobController('lifecycle')
			class LifecycleJob {
				static started = false;
				static completed = false;
				@MonqueJob('long-running')
				async longRunning() {
					LifecycleJob.started = true;
					await new Promise((resolve) => setTimeout(resolve, 500));
					LifecycleJob.completed = true;
				}
			}

			await bootstrapMonque({
				imports: [LifecycleJob],
				connectionStrategy: 'dbFactory',
				monqueConfig: {
					pollInterval: 100,
				},
			});

			const monqueService = PlatformTest.get<MonqueService>(MonqueService);
			await monqueService.now('lifecycle.long-running', {});

			// Wait for it to start
			await waitFor(() => LifecycleJob.started);

			// Stop while it's running
			await monqueService.monque.stop();

			expect(LifecycleJob.completed).toBe(true);
		});
	});
});
