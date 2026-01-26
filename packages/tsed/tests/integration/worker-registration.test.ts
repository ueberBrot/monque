import type { Job } from '@monque/core';
import { PlatformTest } from '@tsed/platform-http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Worker as MonqueWorker, WorkerController } from '@/decorators';
import { MonqueService } from '@/services';

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

		it('should pass concurrency option to worker registration', async () => {
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
			await new Promise((resolve) => setTimeout(resolve, 2000));

			expect(emailWorkers.processed).toContain('test@example.com');
		});
	});
});
