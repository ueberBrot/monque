import { Store } from '@tsed/core';
import { describe, expect, it } from 'vitest';

import { MONQUE } from '@/constants';
import { Cron } from '@/decorators/cron';
import type { WorkerStore } from '@/decorators/types';
import { WorkerController } from '@/decorators/worker-controller';
import { collectWorkerMetadata } from '@/utils/collect-worker-metadata';

describe('collectWorkerMetadata', () => {
	it('should return empty array if no worker store exists', () => {
		class PlainClass {}
		const metadata = collectWorkerMetadata(PlainClass);
		expect(metadata).toEqual([]);
	});

	it('should collect workers and cron jobs', () => {
		@WorkerController('test')
		class TestController {
			@Cron('* * * * *')
			cronJob() {}
		}

		// Manually add a worker to the store to simulate mixed usage
		// (Normally @Worker would do this, but we want to be explicit)
		const store = Store.from(TestController);
		const existing = store.get<Partial<WorkerStore>>(MONQUE) || {};
		store.set(MONQUE, {
			...existing,
			workers: [
				{
					name: 'worker-job',
					method: 'workerMethod',
					opts: { concurrency: 2 },
				},
			],
		});

		const metadata = collectWorkerMetadata(TestController);

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
