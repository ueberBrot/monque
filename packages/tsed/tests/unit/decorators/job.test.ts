/**
 * Unit tests for @Job decorator (T021)
 */
import { Store } from '@tsed/core';
import { describe, expect, it } from 'vitest';

import { MONQUE } from '@/constants';
import type { JobStore } from '@/decorators';
import { Job, JobController } from '@/decorators';

describe('@Job', () => {
	describe('basic decoration', () => {
		it('should add job metadata to the controller store', () => {
			@JobController('email')
			class EmailJob {
				@Job('send')
				async sendEmail() {}
			}

			const store = Store.from(EmailJob);
			const monqueStore = store.get<JobStore>(MONQUE);

			expect(monqueStore?.jobs).toHaveLength(1);
			expect(monqueStore?.jobs[0]).toEqual({
				name: 'send',
				method: 'sendEmail',
				opts: {},
			});
		});

		it('should support multiple jobs on same controller', () => {
			@JobController('notifications')
			class NotificationJob {
				@Job('email')
				async sendEmail() {}

				@Job('sms')
				async sendSms() {}

				@Job('push')
				async sendPush() {}
			}

			const store = Store.from(NotificationJob);
			const monqueStore = store.get<JobStore>(MONQUE);

			expect(monqueStore?.jobs).toHaveLength(3);
			expect(monqueStore?.jobs.map((job) => job.name)).toEqual(['email', 'sms', 'push']);
		});
	});

	describe('options handling', () => {
		it('should store concurrency option', () => {
			@JobController('test')
			class TestJob {
				@Job('process', { concurrency: 10 })
				async process() {}
			}

			const store = Store.from(TestJob);
			const monqueStore = store.get<JobStore>(MONQUE);
			const jobs = monqueStore?.jobs;

			expect(jobs?.[0]?.opts).toEqual({
				concurrency: 10,
			});
		});

		it('should store replace option', () => {
			@JobController('test')
			class TestJob {
				@Job('unique', { replace: true })
				async unique() {}
			}

			const store = Store.from(TestJob);
			const monqueStore = store.get<JobStore>(MONQUE);
			const jobs = monqueStore?.jobs;

			expect(jobs?.[0]?.opts).toEqual({
				replace: true,
			});
		});

		it('should store multiple options together', () => {
			@JobController('test')
			class TestJob {
				@Job('multi', { concurrency: 5, replace: false })
				async multi() {}
			}

			const store = Store.from(TestJob);
			const monqueStore = store.get<JobStore>(MONQUE);
			const jobs = monqueStore?.jobs;

			expect(jobs?.[0]?.opts).toEqual({
				concurrency: 5,
				replace: false,
			});
		});
	});

	describe('method name tracking', () => {
		it('should correctly track method name', () => {
			@JobController('test')
			class TestJob {
				@Job('job-name')
				async myMethodName() {}
			}

			const store = Store.from(TestJob);
			const monqueStore = store.get<JobStore>(MONQUE);
			const jobs = monqueStore?.jobs;

			expect(jobs?.[0]?.method).toBe('myMethodName');
		});
	});

	describe('without JobController', () => {
		it('should initialize MONQUE store if not present', () => {
			// Test that @Job can be applied even if @JobController hasn't been applied yet
			// (decorators are applied bottom-up)
			class PlainClass {
				@Job('test')
				async test() {}
			}

			const store = Store.from(PlainClass);
			const monqueStore = store.get<JobStore>(MONQUE);

			// The @Job decorator should create/merge into the store
			expect(monqueStore?.jobs).toHaveLength(1);
		});

		it('should handle missing jobs array in existing store', () => {
			class TestClass {}
			const store = Store.from(TestClass);
			// Seed store with partial object missing 'jobs'
			store.set(MONQUE, { type: 'controller' }); // no jobs array

			// Apply decorator manually
			const decorator = Job('test');
			decorator(TestClass.prototype, 'method', {} as TypedPropertyDescriptor<unknown>);

			const res = store.get<JobStore>(MONQUE);
			expect(res.jobs).toHaveLength(1);
		});
	});
});
