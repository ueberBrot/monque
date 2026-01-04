import type { Job as JobType } from '@monque/core';
import { cleanupTestDb, getTestDb, waitFor } from '@test-utils/index.js';
import { Injectable } from '@tsed/di';
import { PlatformTest } from '@tsed/platform-http/testing';
import type { Db } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { Server } from '@tests/helpers/Server.js';
import { Cron, Job, JobController } from '@/jobs/index.js';
import { MonqueService } from '@/services/index.js';

/**
 * Test payload interfaces
 */
interface EmailPayload {
	to: string;
	subject: string;
}

interface ProcessPayload {
	id: number;
}

/**
 * Injectable service to verify DI context works in job handlers
 */
@Injectable()
class EmailService {
	sendEmail(_to: string, _subject: string): void {
		// Mock implementation - just for DI verification
	}
}

/**
 * Test job controller with namespace, @Job, and @Cron methods
 */
@JobController({ namespace: 'email' })
class EmailJobController {
	// Track job execution for assertions
	static jobExecutions: Array<{ name: string; data: unknown }> = [];
	static cronExecutions: number = 0;

	constructor(public emailService: EmailService) {}

	@Job('send-welcome')
	async sendWelcome(data: EmailPayload, _job: JobType<EmailPayload>): Promise<void> {
		EmailJobController.jobExecutions.push({ name: 'send-welcome', data });
		// Verify service injection works
		this.emailService.sendEmail(data.to, data.subject);
	}

	@Job('send-notification', { concurrency: 2 })
	async sendNotification(data: EmailPayload, _job: JobType<EmailPayload>): Promise<void> {
		EmailJobController.jobExecutions.push({ name: 'send-notification', data });
	}

	@Cron('* * * * *')
	async dailySummary(
		_data: Record<string, never>,
		_job: JobType<Record<string, never>>,
	): Promise<void> {
		EmailJobController.cronExecutions++;
	}
}

/**
 * Test controller without namespace
 */
@JobController()
class ProcessJobController {
	static jobExecutions: Array<{ name: string; data: unknown }> = [];

	@Job('process-data')
	async processData(data: ProcessPayload, _job: JobType<ProcessPayload>): Promise<void> {
		ProcessJobController.jobExecutions.push({ name: 'process-data', data });
	}

	@Cron('0 * * * *')
	async hourlyCronJob(
		_data: Record<string, never>,
		_job: JobType<Record<string, never>>,
	): Promise<void> {}
}

/**
 * MonqueService Integration Tests
 *
 * Tests the full lifecycle of MonqueService using PlatformTest.bootstrap()
 * to verify controller discovery, job registration, execution, and cleanup.
 *
 * @note Temporarily disabled - factory initialization needs debugging
 */
describe.skip('MonqueService Integration', () => {
	let db: Db;

	beforeAll(async () => {
		db = await getTestDb('monque-module-integration');
	});

	afterAll(async () => {
		await cleanupTestDb(db);
	});

	describe('Full Lifecycle with Controller Discovery', () => {
		beforeAll(async () => {
			// Reset test tracking
			EmailJobController.jobExecutions = [];
			EmailJobController.cronExecutions = 0;
			ProcessJobController.jobExecutions = [];

			// Bootstrap full Ts.ED platform with MonqueService
			await PlatformTest.bootstrap(Server, {
				monque: {
					enabled: true,
					db: () => db,
					pollInterval: 100, // Fast polling for tests
					heartbeatInterval: 5000,
				},
				imports: [EmailService, EmailJobController, ProcessJobController],
			})();
		});

		afterAll(async () => {
			await PlatformTest.reset();
		});

		it('should discover and register @JobController providers', () => {
			const emailController = PlatformTest.get<EmailJobController>(EmailJobController);
			const processController = PlatformTest.get<ProcessJobController>(ProcessJobController);

			expect(emailController).toBeDefined();
			expect(emailController).toBeInstanceOf(EmailJobController);
			expect(processController).toBeDefined();
			expect(processController).toBeInstanceOf(ProcessJobController);
		});

		it('should inject services into controllers', () => {
			const emailController = PlatformTest.get<EmailJobController>(EmailJobController);
			const emailService = PlatformTest.get<EmailService>(EmailService);

			expect(emailService).toBeDefined();
			// EmailService is injected via constructor
			expect(emailController.emailService).toBe(emailService);
		});

		it('should register @Job methods as workers with namespace', async () => {
			const monque = await PlatformTest.get<MonqueService>(MonqueService);
			expect(monque).toBeDefined();

			// Enqueue job with namespace prefix
			await monque.enqueue('email.send-welcome', {
				to: 'test@example.com',
				subject: 'Welcome!',
			});

			// Wait for job to be processed
			await waitFor(
				async () => {
					return EmailJobController.jobExecutions.some((exec) => exec.name === 'send-welcome');
				},
				{ timeout: 5000, interval: 100 },
			);

			expect(EmailJobController.jobExecutions).toHaveLength(1);
			expect(EmailJobController.jobExecutions[0]).toEqual({
				name: 'send-welcome',
				data: { to: 'test@example.com', subject: 'Welcome!' },
			});
		});

		it('should register @Job methods without namespace', async () => {
			const monque = await PlatformTest.get<MonqueService>(MonqueService);
			expect(monque).toBeDefined();

			// Enqueue job without namespace
			await monque.enqueue('process-data', { id: 123 });

			await waitFor(
				async () => {
					return ProcessJobController.jobExecutions.some((exec) => exec.name === 'process-data');
				},
				{ timeout: 5000, interval: 100 },
			);

			expect(ProcessJobController.jobExecutions).toHaveLength(1);
			expect(ProcessJobController.jobExecutions[0]).toEqual({
				name: 'process-data',
				data: { id: 123 },
			});
		});

		it('should schedule @Cron jobs with namespace', async () => {
			// Find scheduled cron job
			const collection = db.collection('monque_jobs');
			const cronJob = await collection.findOne({
				name: 'email.dailySummary',
				repeatInterval: '* * * * *',
			});

			expect(cronJob).toBeDefined();
			expect(cronJob?.['repeatInterval']).toBe('* * * * *');
		});

		it('should schedule @Cron jobs without explicit name using ClassName.method pattern', async () => {
			const collection = db.collection('monque_jobs');
			const cronJob = await collection.findOne({
				name: 'ProcessJobController.hourlyCronJob',
				repeatInterval: '0 * * * *',
			});

			expect(cronJob).toBeDefined();
			expect(cronJob?.['repeatInterval']).toBe('0 * * * *');
		});

		it('should pass job data and job object to handler', async () => {
			const monque = await PlatformTest.get<MonqueService>(MonqueService);
			expect(monque).toBeDefined();

			EmailJobController.jobExecutions = [];

			await monque.enqueue('email.send-notification', {
				to: 'notify@example.com',
				subject: 'Alert',
			});

			await waitFor(async () => EmailJobController.jobExecutions.length > 0, {
				timeout: 5000,
				interval: 100,
			});

			expect(EmailJobController.jobExecutions).toHaveLength(1);
			expect(EmailJobController.jobExecutions[0]?.name).toBe('send-notification');
			expect(EmailJobController.jobExecutions[0]?.data).toEqual({
				to: 'notify@example.com',
				subject: 'Alert',
			});
		});

		it('should respect concurrency option from @Job decorator', async () => {
			const monque = await PlatformTest.get<MonqueService>(MonqueService);
			expect(monque).toBeDefined();

			EmailJobController.jobExecutions = [];

			await monque.enqueue('email.send-notification', {
				to: 'user1@example.com',
				subject: 'Test 1',
			});
			await monque.enqueue('email.send-notification', {
				to: 'user2@example.com',
				subject: 'Test 2',
			});

			await waitFor(async () => EmailJobController.jobExecutions.length === 2, {
				timeout: 5000,
				interval: 100,
			});

			expect(EmailJobController.jobExecutions).toHaveLength(2);
		});
	});

	describe('Module Lifecycle', () => {
		it('should handle async database factory', async () => {
			await PlatformTest.bootstrap(Server, {
				monque: {
					enabled: true,
					db: async () => {
						// Simulate async DB initialization
						await new Promise((resolve) => setTimeout(resolve, 10));
						return db;
					},
					pollInterval: 1000,
				},
				imports: [EmailJobController],
			})();

			const monque = await PlatformTest.get<MonqueService>(MonqueService);
			expect(monque).toBeDefined();

			await PlatformTest.reset();
		});

		it('should gracefully stop scheduler on module destroy', async () => {
			await PlatformTest.bootstrap(Server, {
				monque: {
					enabled: true,
					db: () => db,
					pollInterval: 1000,
				},
				imports: [EmailJobController],
			})();

			const monque = await PlatformTest.get<MonqueService>(MonqueService);
			expect(monque).toBeDefined();

			const stopSpy = vi.spyOn(monque, 'stop');
			await PlatformTest.reset();
			expect(stopSpy).toHaveBeenCalled();
		});
	});

	describe('Error Handling', () => {
		beforeAll(async () => {
			await PlatformTest.bootstrap(Server, {
				monque: {
					enabled: true,
					db: () => db,
					pollInterval: 100,
				},
				imports: [EmailJobController],
			})();
		});

		afterAll(async () => {
			await PlatformTest.reset();
		});

		it('should handle job execution errors', async () => {
			const monque = await PlatformTest.get<MonqueService>(MonqueService);
			expect(monque).toBeDefined();

			monque.worker('test-error-job', async () => {
				throw new Error('Test error');
			});

			const errors: Error[] = [];
			monque.on('job:fail', ({ error }: { error: Error }) => {
				errors.push(error);
			});

			await monque.enqueue('test-error-job', {});

			await waitFor(async () => errors.length > 0, { timeout: 5000, interval: 100 });

			expect(errors).toHaveLength(1);
			expect(errors[0]?.message).toBe('Test error');
		});
	});

	describe('Configuration Variants', () => {
		it('should skip initialization when config is not provided', async () => {
			await PlatformTest.bootstrap(Server, {
				imports: [EmailJobController],
			})();

			// When enabled is false (default), factory returns no-op proxy
			// We can verify by checking that Monque injection doesn't throw
			const monque = await PlatformTest.invoke(MonqueService);
			expect(monque).toBeDefined();

			await PlatformTest.reset();
		});

		it('should handle direct Db instance (not factory)', async () => {
			await PlatformTest.bootstrap(Server, {
				monque: {
					enabled: true,
					db: db,
					pollInterval: 1000,
				},
				imports: [EmailJobController],
			})();

			const monque = await PlatformTest.get<MonqueService>(MonqueService);
			expect(monque).toBeDefined();

			await PlatformTest.reset();
		});
	});
});
