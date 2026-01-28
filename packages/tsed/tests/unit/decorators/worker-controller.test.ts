/**
 * Unit tests for @WorkerController decorator (T020)
 */
import { Store } from '@tsed/core';
import { Provider } from '@tsed/di';
import { describe, expect, it } from 'vitest';

import { MONQUE, ProviderTypes } from '@/constants';
import type { WorkerStore } from '@/decorators';
import { WorkerController } from '@/decorators';

describe('@WorkerController', () => {
	describe('basic decoration', () => {
		it('should mark class as injectable with WORKER_CONTROLLER type', () => {
			@WorkerController()
			class TestWorker {}

			const provider = Provider.Registry.get(TestWorker);
			expect(provider).toBeDefined();
			expect(provider?.type).toBe(ProviderTypes.WORKER_CONTROLLER);
		});

		it('should store empty namespace when no argument provided', () => {
			@WorkerController()
			class TestWorker {}

			const store = Store.from(TestWorker);
			const monqueStore = store.get<WorkerStore>(MONQUE);

			expect(monqueStore).toBeDefined();
			expect(monqueStore.namespace).toBeUndefined();
		});

		it('should store namespace when provided', () => {
			@WorkerController('email')
			class EmailWorker {}

			const store = Store.from(EmailWorker);
			const monqueStore = store.get<WorkerStore>(MONQUE);

			expect(monqueStore).toBeDefined();
			expect(monqueStore.namespace).toBe('email');
		});
	});

	describe('worker store initialization', () => {
		it('should initialize workers array as empty', () => {
			@WorkerController('test')
			class TestWorker {}

			const store = Store.from(TestWorker);
			const monqueStore = store.get<WorkerStore>(MONQUE);

			expect(monqueStore.workers).toEqual([]);
		});

		it('should initialize cronJobs array as empty', () => {
			@WorkerController('test')
			class TestWorker {}

			const store = Store.from(TestWorker);
			const monqueStore = store.get<WorkerStore>(MONQUE);

			expect(monqueStore.cronJobs).toEqual([]);
		});

		it('should set type to "controller"', () => {
			@WorkerController('test')
			class TestWorker {}

			const store = Store.from(TestWorker);
			const monqueStore = store.get<WorkerStore>(MONQUE);

			expect(monqueStore.type).toBe('controller');
		});
	});

	describe('provider registration', () => {
		it('should register class as singleton scope', () => {
			@WorkerController()
			class TestWorker {}

			const store = Store.from(TestWorker);
			// Singleton is the default scope in Ts.ED
			expect(store.get('scope')).toBeUndefined(); // undefined means singleton
		});
	});
});
