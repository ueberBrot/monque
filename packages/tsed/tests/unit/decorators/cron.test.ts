import { Store } from '@tsed/core';
import { describe, expect, it } from 'vitest';

import { MONQUE } from '@/constants';
import { Cron } from '@/decorators/cron';
import { JobController } from '@/decorators/job-controller';
import type { JobStore } from '@/decorators/types';

describe('@Cron', () => {
	it('should register a cron job in the store', () => {
		@JobController('test')
		class TestController {
			@Cron('* * * * *')
			testMethod() {}
		}

		const store = Store.from(TestController).get<JobStore>(MONQUE);

		expect(store).toBeDefined();
		expect(store.cronJobs).toHaveLength(1);
		expect(store.cronJobs[0]).toEqual({
			pattern: '* * * * *',
			name: 'testMethod',
			method: 'testMethod',
			opts: {},
		});
	});

	it('should register a cron job with options', () => {
		@JobController('test')
		class TestController {
			@Cron('0 0 * * *', { name: 'custom-name' })
			dailyJob() {}
		}

		const store = Store.from(TestController).get<JobStore>(MONQUE);

		expect(store.cronJobs).toHaveLength(1);
		expect(store.cronJobs[0]).toEqual({
			pattern: '0 0 * * *',
			name: 'custom-name',
			method: 'dailyJob',
			opts: {
				name: 'custom-name',
			},
		});
	});

	it('should register multiple cron jobs', () => {
		@JobController('test')
		class TestController {
			@Cron('* * * * *')
			job1() {}

			@Cron('@daily')
			job2() {}
		}

		const store = Store.from(TestController).get<JobStore>(MONQUE);

		expect(store.cronJobs).toHaveLength(2);
		expect(store.cronJobs[0]?.method).toBe('job1');
		expect(store.cronJobs[1]?.method).toBe('job2');
	});

	it('should preserve existing jobs in the store', () => {
		// Mock existing store
		class TestTarget {}
		const store = Store.from(TestTarget);
		store.set(MONQUE, {
			type: 'controller',
			jobs: [{ name: 'existing', method: 'existing', opts: {} }],
			cronJobs: [],
		});

		// Apply decorator manually
		const decorator = Cron('* * * * *');
		decorator(TestTarget.prototype, 'newJob', {
			value: () => {},
		} as TypedPropertyDescriptor<unknown>);

		const updatedStore = store.get<JobStore>(MONQUE);

		expect(updatedStore.jobs).toHaveLength(1);
		expect(updatedStore.cronJobs).toHaveLength(1);
	});

	it('should handle missing cronJobs array in existing store', () => {
		class TestClass {}
		const store = Store.from(TestClass);
		// Seed store with partial object missing 'cronJobs'
		store.set(MONQUE, { type: 'controller' });

		// Apply decorator manually
		const decorator = Cron('* * * * *');
		decorator(TestClass.prototype, 'cronMethod', {} as TypedPropertyDescriptor<unknown>);

		const res = store.get<JobStore>(MONQUE);
		expect(res.cronJobs).toHaveLength(1);
	});
});
