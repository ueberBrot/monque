import { Store } from '@tsed/core';
import { describe, expect, it } from 'vitest';

import { MONQUE } from '@/constants';
import { Cron } from '@/decorators/cron';
import { JobController } from '@/decorators/job-controller';
import type { JobStore } from '@/decorators/types';
import { collectJobMetadata } from '@/utils/collect-job-metadata';

describe('collectJobMetadata', () => {
	it('should return empty array if no job store exists', () => {
		class PlainClass {}
		const metadata = collectJobMetadata(PlainClass);
		expect(metadata).toEqual([]);
	});

	it('should collect jobs and cron jobs', () => {
		@JobController('test')
		class TestController {
			@Cron('* * * * *')
			cronJob() {}
		}

		// Manually add a job to the store to simulate mixed usage
		// (Normally @Job would do this, but we want to be explicit)
		const store = Store.from(TestController);
		const existing = store.get<Partial<JobStore>>(MONQUE) || {};
		store.set(MONQUE, {
			...existing,
			jobs: [
				{
					name: 'worker-job',
					method: 'workerMethod',
					opts: { concurrency: 2 },
				},
			],
		});

		const metadata = collectJobMetadata(TestController);

		expect(metadata).toHaveLength(2);
		expect(metadata).toEqual(
			expect.arrayContaining([
				{
					fullName: 'test.cronJob',
					method: 'cronJob',
					opts: {},
					isCron: true,
					cronPattern: '* * * * *',
				},
				{
					fullName: 'test.worker-job',
					method: 'workerMethod',
					opts: { concurrency: 2 },
					isCron: false,
				},
			]),
		);
	});
});
