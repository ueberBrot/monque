/**
 * Unit tests for @Worker decorator (T021)
 */
import { Store } from '@tsed/core';
import { describe, expect, it } from 'vitest';

import { MONQUE } from '@/constants';
import type { WorkerStore } from '@/decorators';
import { Worker, WorkerController } from '@/decorators';

describe('@Worker', () => {
	describe('basic decoration', () => {
		it('should add worker metadata to the controller store', () => {
			@WorkerController('email')
			class EmailWorker {
				@Worker('send')
				async sendEmail() {}
			}

			const store = Store.from(EmailWorker);
			const monqueStore = store.get<WorkerStore>(MONQUE);

			expect(monqueStore?.workers).toHaveLength(1);
			expect(monqueStore?.workers[0]).toEqual({
				name: 'send',
				method: 'sendEmail',
				opts: {},
			});
		});

		it('should support multiple workers on same controller', () => {
			@WorkerController('notifications')
			class NotificationWorker {
				@Worker('email')
				async sendEmail() {}

				@Worker('sms')
				async sendSms() {}

				@Worker('push')
				async sendPush() {}
			}

			const store = Store.from(NotificationWorker);
			const monqueStore = store.get<WorkerStore>(MONQUE);

			expect(monqueStore?.workers).toHaveLength(3);
			expect(monqueStore?.workers.map((w) => w.name)).toEqual(['email', 'sms', 'push']);
		});
	});

	describe('options handling', () => {
		it('should store concurrency option', () => {
			@WorkerController('test')
			class TestWorker {
				@Worker('process', { concurrency: 10 })
				async process() {}
			}

			const store = Store.from(TestWorker);
			const monqueStore = store.get<WorkerStore>(MONQUE);
			const workers = monqueStore?.workers;

			expect(workers?.[0]?.opts).toEqual({
				concurrency: 10,
			});
		});

		it('should store replace option', () => {
			@WorkerController('test')
			class TestWorker {
				@Worker('unique', { replace: true })
				async unique() {}
			}

			const store = Store.from(TestWorker);
			const monqueStore = store.get<WorkerStore>(MONQUE);
			const workers = monqueStore?.workers;

			expect(workers?.[0]?.opts).toEqual({
				replace: true,
			});
		});

		it('should store multiple options together', () => {
			@WorkerController('test')
			class TestWorker {
				@Worker('multi', { concurrency: 5, replace: false })
				async multi() {}
			}

			const store = Store.from(TestWorker);
			const monqueStore = store.get<WorkerStore>(MONQUE);
			const workers = monqueStore?.workers;

			expect(workers?.[0]?.opts).toEqual({
				concurrency: 5,
				replace: false,
			});
		});
	});

	describe('method name tracking', () => {
		it('should correctly track method name', () => {
			@WorkerController('test')
			class TestWorker {
				@Worker('job-name')
				async myMethodName() {}
			}

			const store = Store.from(TestWorker);
			const monqueStore = store.get<WorkerStore>(MONQUE);
			const workers = monqueStore?.workers;

			expect(workers?.[0]?.method).toBe('myMethodName');
		});
	});

	describe('without WorkerController', () => {
		it('should initialize MONQUE store if not present', () => {
			// Test that @Worker can be applied even if @WorkerController hasn't been applied yet
			// (decorators are applied bottom-up)
			class PlainClass {
				@Worker('test')
				async test() {}
			}

			const store = Store.from(PlainClass);
			const monqueStore = store.get<WorkerStore>(MONQUE);

			// The @Worker decorator should create/merge into the store
			expect(monqueStore?.workers).toHaveLength(1);
		});
	});
});
