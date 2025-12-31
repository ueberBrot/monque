import type { Job as JobType } from '@monque/core';
import { Store } from '@tsed/core';
import { DITest, injector } from '@tsed/di';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MONQUE_METADATA } from '@/constants/constants';
import { MonqueTypes } from '@/constants/MonqueTypes';
import type { JobMethods } from '@/contracts/JobMethods';
import { Job } from '@/decorators/job';
import { getJobToken } from '@/utils/getJobToken';

interface TestPayload {
	message: string;
}

@Job('test-job')
class TestJob implements JobMethods<TestPayload> {
	handle(_data: TestPayload, _job: JobType<TestPayload>): void {
		// no-op
	}
}

@Job('custom-token-job', { token: 'my:custom:token' })
class CustomTokenJob implements JobMethods<TestPayload> {
	handle(_data: TestPayload, _job: JobType<TestPayload>): void {
		// no-op
	}
}

@Job('options-job', { uniqueKey: 'test-unique' })
class OptionsJob implements JobMethods<TestPayload> {
	handle(_data: TestPayload, _job: JobType<TestPayload>): void {
		// no-op
	}
}

describe('@Job Decorator', () => {
	beforeEach(() => DITest.create());
	afterEach(() => DITest.reset());

	it('should register provider with MonqueTypes.JOB type', () => {
		const provider = injector().getProvider(getJobToken('test-job'));

		expect(provider).toBeDefined();
		expect(provider?.type).toBe(MonqueTypes.JOB);
	});

	it('should set correct metadata with job name', () => {
		const store = Store.from(TestJob);
		const metadata = store.get(MONQUE_METADATA);

		expect(metadata).toBeDefined();
		expect(metadata.name).toBe('test-job');
		expect(metadata.options).toEqual({});
	});

	it('should use custom token when provided', () => {
		const provider = injector().getProvider('my:custom:token');

		expect(provider).toBeDefined();
		expect(provider?.token).toBe('my:custom:token');
		expect(provider?.useClass).toBe(CustomTokenJob);
	});

	it('should use generated token when not specified', () => {
		const provider = injector().getProvider(getJobToken('test-job'));

		expect(provider).toBeDefined();
		expect(provider?.token).toBe(getJobToken('test-job'));
		expect(provider?.token).toBe('monque:job:test-job');
	});

	it('should store options in metadata', () => {
		const store = Store.from(OptionsJob);
		const metadata = store.get(MONQUE_METADATA);

		expect(metadata.options).toEqual({
			uniqueKey: 'test-unique',
		});
	});

	it('should generate unique tokens for different job names', () => {
		const token1 = getJobToken('job-one');
		const token2 = getJobToken('job-two');

		expect(token1).not.toBe(token2);
		expect(token1).toBe('monque:job:job-one');
		expect(token2).toBe('monque:job:job-two');
	});
});
