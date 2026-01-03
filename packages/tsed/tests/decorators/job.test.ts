import { Store } from '@tsed/core';
import { describe, expect, it } from 'vitest';

import { type ControllerStore, Job } from '@/jobs';
import { MONQUE_METADATA } from '@/shared';

describe('Job method decorator', () => {
	it('should store job name in metadata', () => {
		class TestController {
			@Job('send-email')
			sendEmail() {}
		}

		const store = Store.from(TestController);
		const metadata = store.get<ControllerStore>(MONQUE_METADATA);

		expect(metadata?.jobs).toBeDefined();
		expect(metadata?.jobs?.['sendEmail']).toEqual({
			name: 'send-email',
			options: undefined,
		});
	});

	it('should store job options when provided', () => {
		class TestController {
			@Job('process-video', { concurrency: 2 })
			processVideo() {}
		}

		const store = Store.from(TestController);
		const metadata = store.get<ControllerStore>(MONQUE_METADATA);

		expect(metadata?.jobs?.['processVideo']).toEqual({
			name: 'process-video',
			options: { concurrency: 2 },
		});
	});

	it('should support multiple job methods in same class', () => {
		class TestController {
			@Job('send-welcome')
			sendWelcome() {}

			@Job('send-notification')
			sendNotification() {}
		}

		const store = Store.from(TestController);
		const metadata = store.get<ControllerStore>(MONQUE_METADATA);

		expect(metadata?.jobs?.['sendWelcome']).toEqual({
			name: 'send-welcome',
			options: undefined,
		});
		expect(metadata?.jobs?.['sendNotification']).toEqual({
			name: 'send-notification',
			options: undefined,
		});
	});

	it('should handle jobs with various option combinations', () => {
		class TestController {
			@Job('basic-job')
			basicJob() {}

			@Job('concurrent-job', { concurrency: 5 })
			concurrentJob() {}
		}

		const store = Store.from(TestController);
		const metadata = store.get<ControllerStore>(MONQUE_METADATA);

		expect(metadata?.jobs?.['basicJob']?.options).toBeUndefined();
		expect(metadata?.jobs?.['concurrentJob']?.options?.concurrency).toBe(5);
	});

	it('should preserve method name as key in metadata', () => {
		class TestController {
			@Job('custom-name')
			myMethodName() {}
		}

		const store = Store.from(TestController);
		const metadata = store.get<ControllerStore>(MONQUE_METADATA);

		expect(metadata?.jobs).toHaveProperty('myMethodName');
		expect(metadata?.jobs?.['myMethodName']?.name).toBe('custom-name');
	});
});
