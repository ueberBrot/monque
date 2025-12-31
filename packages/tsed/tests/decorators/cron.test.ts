import { Store } from '@tsed/core';
import { describe, expect, it } from 'vitest';

import { MONQUE_METADATA } from '@/constants/constants';
import { Cron } from '@/decorators/method';
import type { ControllerStore } from '@/types';

describe('Cron method decorator', () => {
	it('should store cron expression in metadata', () => {
		class TestController {
			@Cron('0 9 * * *')
			dailyJob() {}
		}

		const store = Store.from(TestController);
		const metadata = store.get<ControllerStore>(MONQUE_METADATA);

		expect(metadata?.cron).toBeDefined();
		expect(metadata?.cron?.['dailyJob']).toEqual({
			expression: '0 9 * * *',
			options: undefined,
		});
	});

	it('should store cron options when provided', () => {
		class TestController {
			@Cron('*/5 * * * *', { concurrency: 1, uniqueKey: 'custom-key' })
			frequentJob() {}
		}

		const store = Store.from(TestController);
		const metadata = store.get<ControllerStore>(MONQUE_METADATA);

		expect(metadata?.cron?.['frequentJob']).toEqual({
			expression: '*/5 * * * *',
			options: { concurrency: 1, uniqueKey: 'custom-key' },
		});
	});

	it('should support multiple cron methods in same class', () => {
		class TestController {
			@Cron('0 9 * * *')
			morningJob() {}

			@Cron('0 18 * * *')
			eveningJob() {}
		}

		const store = Store.from(TestController);
		const metadata = store.get<ControllerStore>(MONQUE_METADATA);

		expect(metadata?.cron?.['morningJob']).toEqual({
			expression: '0 9 * * *',
			options: undefined,
		});
		expect(metadata?.cron?.['eveningJob']).toEqual({
			expression: '0 18 * * *',
			options: undefined,
		});
	});

	it('should support any cron expression format', () => {
		class TestController {
			@Cron('0 0 1 * *') // First day of month
			monthlyJob() {}

			@Cron('0 0 * * 0') // Every Sunday
			weeklyJob() {}

			@Cron('*/15 * * * *') // Every 15 minutes
			quarterHourlyJob() {}
		}

		const store = Store.from(TestController);
		const metadata = store.get<ControllerStore>(MONQUE_METADATA);

		expect(metadata?.cron?.['monthlyJob']?.expression).toBe('0 0 1 * *');
		expect(metadata?.cron?.['weeklyJob']?.expression).toBe('0 0 * * 0');
		expect(metadata?.cron?.['quarterHourlyJob']?.expression).toBe('*/15 * * * *');
	});

	it('should support custom unique key in options', () => {
		class TestController {
			@Cron('0 9 * * *', { uniqueKey: 'my-unique-digest' })
			sendDigest() {}
		}

		const store = Store.from(TestController);
		const metadata = store.get<ControllerStore>(MONQUE_METADATA);

		expect(metadata?.cron?.['sendDigest']?.options?.uniqueKey).toBe('my-unique-digest');
	});
});
