import type { PersistedJob } from '@monque/core';
import { PlatformTest } from '@tsed/platform-http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Cron, JobController } from '@/decorators';
import { MonqueService } from '@/services';

import { waitFor } from '../test-utils.js';
import { bootstrapMonque, resetMonque } from './helpers/bootstrap.js';

@JobController('cron-test')
class CronTestJobs {
	public static callCount = 0;

	@Cron('* * * * *', { name: 'minutely-job' })
	async runEveryMinute() {
		CronTestJobs.callCount++;
	}
}

describe('Cron Job Integration', () => {
	afterEach(resetMonque);

	describe('Cron Scheduling', () => {
		beforeEach(async () => {
			CronTestJobs.callCount = 0;
			await bootstrapMonque({
				imports: [CronTestJobs],
				connectionStrategy: 'dbFactory',
			});
		});

		it('should schedule cron job on startup', async () => {
			const monqueService = PlatformTest.get<MonqueService>(MonqueService);
			expect(monqueService).toBeDefined();

			// Verify job exists in DB
			const jobs = await monqueService.getJobs({ name: 'cron-test.minutely-job' });
			// Monque.schedule ensures a single job for the schedule signature
			expect(jobs.length).toBeGreaterThan(0);
			const scheduleJob = jobs.find((j: PersistedJob<unknown>) => j.repeatInterval === '* * * * *');
			expect(scheduleJob).toBeDefined();
		});

		it('should execute cron job handler when triggered', async () => {
			const monqueService = PlatformTest.get<MonqueService>(MonqueService);

			// Manually trigger the job to avoid waiting for cron
			// The job should be registered for 'minutely-job'
			await monqueService.now('cron-test.minutely-job', {});

			// Wait for processing
			await waitFor(() => CronTestJobs.callCount >= 1);

			expect(CronTestJobs.callCount).toBe(1);
		});
	});
});
