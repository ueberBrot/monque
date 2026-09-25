import { describe, expect, it } from 'vitest';

import { JobFactoryHelpers } from '@tests/factories';
import {
	AggregationTimeoutError,
	ConnectionError,
	InvalidCronError,
	InvalidCursorError,
	InvalidJobIdentifierError,
	JobStateError,
	MonqueError,
	ShutdownTimeoutError,
	WorkerRegistrationError,
} from '@/shared';

describe('errors', () => {
	it.each([
		{ name: 'MonqueError', create: () => new MonqueError('Test message') },
		{ name: 'InvalidCronError', create: () => new InvalidCronError('bad cron', 'Test message') },
		{ name: 'ConnectionError', create: () => new ConnectionError('Test message') },
		{ name: 'ShutdownTimeoutError', create: () => new ShutdownTimeoutError('Test message', []) },
		{
			name: 'WorkerRegistrationError',
			create: () => new WorkerRegistrationError('Test message', 'job'),
		},
		{
			name: 'JobStateError',
			create: () => new JobStateError('Test message', 'id', 'processing', 'cancel'),
		},
		{ name: 'InvalidCursorError', create: () => new InvalidCursorError('Test message') },
		{
			name: 'InvalidJobIdentifierError',
			create: () => new InvalidJobIdentifierError('name', 'bad', 'Test message'),
		},
		{ name: 'AggregationTimeoutError', create: () => new AggregationTimeoutError('Test message') },
	])('$name preserves its message, name, stack and error hierarchy', ({ name, create }) => {
		const error = create();
		expect(error.message).toBe('Test message');
		expect(error.name).toBe(name);
		expect(error.stack).toContain(`${name}: Test message`);
		expect(error).toBeInstanceOf(MonqueError);
		expect(error).toBeInstanceOf(Error);
	});

	it('exposes the invalid cron expression', () => {
		expect(new InvalidCronError('60 * * * *', 'Invalid').expression).toBe('60 * * * *');
	});

	it('chains the original connection error as its cause', () => {
		const cause = new Error('Original database error');
		expect(new ConnectionError('Connection failed', { cause }).cause).toBe(cause);
	});

	it('preserves incomplete jobs and their payloads on shutdown timeout', () => {
		const jobs = [
			JobFactoryHelpers.processing({ name: 'job1' }),
			JobFactoryHelpers.processing({ name: 'job2' }),
		];
		expect(new ShutdownTimeoutError('Timeout', jobs).incompleteJobs).toEqual(jobs);
		expect(new ShutdownTimeoutError('Timeout', []).incompleteJobs).toEqual([]);
	});

	it('identifies the worker that failed registration', () => {
		expect(new WorkerRegistrationError('Duplicate worker', 'send-email').jobName).toBe(
			'send-email',
		);
	});

	it('identifies the job, state and attempted action for invalid transitions', () => {
		const error = new JobStateError('Invalid transition', 'job-123', 'processing', 'cancel');
		expect(error).toMatchObject({
			jobId: 'job-123',
			currentStatus: 'processing',
			attemptedAction: 'cancel',
		});
	});

	it('identifies the invalid identifier field and value', () => {
		expect(new InvalidJobIdentifierError('name', 'bad name', 'Invalid')).toMatchObject({
			field: 'name',
			value: 'bad name',
		});
	});

	it('provides a default aggregation timeout message', () => {
		expect(new AggregationTimeoutError().message).toContain('exceeded 30 second timeout');
	});
});
