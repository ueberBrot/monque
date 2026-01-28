/**
 * Unit tests for @JobController decorator (T020)
 */
import { Store } from '@tsed/core';
import { Provider } from '@tsed/di';
import { describe, expect, it } from 'vitest';

import { MONQUE, ProviderTypes } from '@/constants';
import type { JobStore } from '@/decorators';
import { JobController } from '@/decorators';

describe('@JobController', () => {
	describe('basic decoration', () => {
		it('should mark class as injectable with JOB_CONTROLLER type', () => {
			@JobController()
			class TestJob {}

			const provider = Provider.Registry.get(TestJob);
			expect(provider).toBeDefined();
			expect(provider?.type).toBe(ProviderTypes.JOB_CONTROLLER);
		});

		it('should store empty namespace when no argument provided', () => {
			@JobController()
			class TestJob {}

			const store = Store.from(TestJob);
			const monqueStore = store.get<JobStore>(MONQUE);

			expect(monqueStore).toBeDefined();
			expect(monqueStore.namespace).toBeUndefined();
		});

		it('should store namespace when provided', () => {
			@JobController('email')
			class EmailJob {}

			const store = Store.from(EmailJob);
			const monqueStore = store.get<JobStore>(MONQUE);

			expect(monqueStore).toBeDefined();
			expect(monqueStore.namespace).toBe('email');
		});
	});

	describe('job store initialization', () => {
		it('should initialize jobs array as empty', () => {
			@JobController('test')
			class TestJob {}

			const store = Store.from(TestJob);
			const monqueStore = store.get<JobStore>(MONQUE);

			expect(monqueStore.jobs).toEqual([]);
		});

		it('should initialize cronJobs array as empty', () => {
			@JobController('test')
			class TestJob {}

			const store = Store.from(TestJob);
			const monqueStore = store.get<JobStore>(MONQUE);

			expect(monqueStore.cronJobs).toEqual([]);
		});

		it('should set type to "controller"', () => {
			@JobController('test')
			class TestJob {}

			const store = Store.from(TestJob);
			const monqueStore = store.get<JobStore>(MONQUE);

			expect(monqueStore.type).toBe('controller');
		});
	});

	describe('provider registration', () => {
		it('should register class as singleton scope', () => {
			@JobController()
			class TestJob {}

			const store = Store.from(TestJob);
			// Singleton is the default scope in Ts.ED
			expect(store.get('scope')).toBeUndefined(); // undefined means singleton
		});
	});
});
