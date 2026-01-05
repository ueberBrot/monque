/**
 * Tests for custom error classes in the Monque scheduler.
 *
 * These tests verify:
 * - MonqueError base class functionality
 * - InvalidCronError with expression storage
 * - ConnectionError for database issues
 * - ShutdownTimeoutError with incomplete jobs tracking
 * - Error inheritance chain (all catchable as Error/MonqueError)
 *
 * @see {@link @/shared/errors.js}
 */

import { describe, expect, it } from 'vitest';

import { JobFactoryHelpers } from '@tests/factories/job.factory.js';
import {
	ConnectionError,
	InvalidCronError,
	MonqueError,
	ShutdownTimeoutError,
	WorkerRegistrationError,
} from '@/shared';

describe('errors', () => {
	describe('MonqueError', () => {
		it('should create an error with the correct message', () => {
			const error = new MonqueError('Test error message');
			expect(error.message).toBe('Test error message');
		});

		it('should have name "MonqueError"', () => {
			const error = new MonqueError('Test');
			expect(error.name).toBe('MonqueError');
		});

		it('should be an instance of Error', () => {
			const error = new MonqueError('Test');
			expect(error).toBeInstanceOf(Error);
		});

		it('should be an instance of MonqueError', () => {
			const error = new MonqueError('Test');
			expect(error).toBeInstanceOf(MonqueError);
		});

		it('should have a stack trace', () => {
			const error = new MonqueError('Test');
			expect(error.stack).toBeDefined();
			expect(error.stack).toContain('MonqueError');
		});
	});

	describe('InvalidCronError', () => {
		it('should create an error with expression and message', () => {
			const error = new InvalidCronError('bad cron', 'Invalid expression');
			expect(error.message).toBe('Invalid expression');
			expect(error.expression).toBe('bad cron');
		});

		it('should have name "InvalidCronError"', () => {
			const error = new InvalidCronError('* *', 'Too few fields');
			expect(error.name).toBe('InvalidCronError');
		});

		it('should be an instance of MonqueError', () => {
			const error = new InvalidCronError('x', 'Invalid');
			expect(error).toBeInstanceOf(MonqueError);
		});

		it('should be an instance of Error', () => {
			const error = new InvalidCronError('x', 'Invalid');
			expect(error).toBeInstanceOf(Error);
		});

		it('should expose the invalid expression', () => {
			const expression = '60 * * * *';
			const error = new InvalidCronError(expression, 'Minute out of range');
			expect(error.expression).toBe(expression);
		});

		it('should have a stack trace', () => {
			const error = new InvalidCronError('bad', 'Invalid');
			expect(error.stack).toBeDefined();
		});
	});

	describe('ConnectionError', () => {
		it('should create an error with the correct message', () => {
			const error = new ConnectionError('Database connection failed');
			expect(error.message).toBe('Database connection failed');
		});

		it('should have name "ConnectionError"', () => {
			const error = new ConnectionError('Connection lost');
			expect(error.name).toBe('ConnectionError');
		});

		it('should be an instance of MonqueError', () => {
			const error = new ConnectionError('Timeout');
			expect(error).toBeInstanceOf(MonqueError);
		});

		it('should be an instance of Error', () => {
			const error = new ConnectionError('Timeout');
			expect(error).toBeInstanceOf(Error);
		});

		it('should have a stack trace', () => {
			const error = new ConnectionError('Failed');
			expect(error.stack).toBeDefined();
		});
	});

	describe('ShutdownTimeoutError', () => {
		it('should create an error with message and incomplete jobs', () => {
			const incompleteJobs = [
				JobFactoryHelpers.processing({ name: 'job1' }),
				JobFactoryHelpers.processing({ name: 'job2' }),
			];
			const error = new ShutdownTimeoutError('Shutdown timed out', incompleteJobs);

			expect(error.message).toBe('Shutdown timed out');
			expect(error.incompleteJobs).toEqual(incompleteJobs);
		});

		it('should have name "ShutdownTimeoutError"', () => {
			const error = new ShutdownTimeoutError('Timeout', []);
			expect(error.name).toBe('ShutdownTimeoutError');
		});

		it('should be an instance of MonqueError', () => {
			const error = new ShutdownTimeoutError('Timeout', []);
			expect(error).toBeInstanceOf(MonqueError);
		});

		it('should be an instance of Error', () => {
			const error = new ShutdownTimeoutError('Timeout', []);
			expect(error).toBeInstanceOf(Error);
		});

		it('should expose incompleteJobs array', () => {
			const job = JobFactoryHelpers.processing({ name: 'job1' });
			const error = new ShutdownTimeoutError('Timeout', [job]);
			expect(error.incompleteJobs).toHaveLength(1);
			expect(error.incompleteJobs[0]?.name).toBe(job.name);
		});

		it('should handle empty incompleteJobs array', () => {
			const error = new ShutdownTimeoutError('No jobs running', []);
			expect(error.incompleteJobs).toHaveLength(0);
		});

		it('should preserve job data in incompleteJobs', () => {
			const job = JobFactoryHelpers.processing();
			const error = new ShutdownTimeoutError('Timeout', [job]);

			expect(error.incompleteJobs[0]?.data).toEqual(job.data);
		});

		it('should have a stack trace', () => {
			const error = new ShutdownTimeoutError('Timeout', []);
			expect(error.stack).toBeDefined();
		});
	});

	describe('WorkerRegistrationError', () => {
		it('should create an error with message and job name', () => {
			const error = new WorkerRegistrationError('Worker already registered', 'test-job');
			expect(error.message).toBe('Worker already registered');
			expect(error.jobName).toBe('test-job');
		});

		it('should have name "WorkerRegistrationError"', () => {
			const error = new WorkerRegistrationError('Error', 'job');
			expect(error.name).toBe('WorkerRegistrationError');
		});

		it('should be an instance of MonqueError', () => {
			const error = new WorkerRegistrationError('Error', 'job');
			expect(error).toBeInstanceOf(MonqueError);
		});

		it('should be an instance of Error', () => {
			const error = new WorkerRegistrationError('Error', 'job');
			expect(error).toBeInstanceOf(Error);
		});

		it('should have a stack trace', () => {
			const error = new WorkerRegistrationError('Error', 'job');
			expect(error.stack).toBeDefined();
		});
	});

	describe('error inheritance chain', () => {
		it('InvalidCronError should be catchable as MonqueError', () => {
			const error = new InvalidCronError('bad', 'Invalid');
			let caught = false;

			try {
				throw error;
			} catch (e) {
				if (e instanceof MonqueError) {
					caught = true;
				}
			}

			expect(caught).toBe(true);
		});

		it('ConnectionError should be catchable as MonqueError', () => {
			const error = new ConnectionError('Failed');
			let caught = false;

			try {
				throw error;
			} catch (e) {
				if (e instanceof MonqueError) {
					caught = true;
				}
			}

			expect(caught).toBe(true);
		});

		it('ShutdownTimeoutError should be catchable as MonqueError', () => {
			const error = new ShutdownTimeoutError('Timeout', []);
			let caught = false;

			try {
				throw error;
			} catch (e) {
				if (e instanceof MonqueError) {
					caught = true;
				}
			}

			expect(caught).toBe(true);
		});

		it('WorkerRegistrationError should be catchable as MonqueError', () => {
			const error = new WorkerRegistrationError('Failed', 'job');
			let caught = false;

			try {
				throw error;
			} catch (e) {
				if (e instanceof MonqueError) {
					caught = true;
				}
			}

			expect(caught).toBe(true);
		});

		it('all errors should be catchable as Error', () => {
			const errors = [
				new MonqueError('Base'),
				new InvalidCronError('x', 'Invalid'),
				new ConnectionError('Failed'),
				new ShutdownTimeoutError('Timeout', []),
				new WorkerRegistrationError('Failed', 'job'),
			];

			for (const error of errors) {
				let caught = false;
				try {
					throw error;
				} catch (e) {
					if (e instanceof Error) {
						caught = true;
					}
				}
				expect(caught).toBe(true);
			}
		});
	});
});
