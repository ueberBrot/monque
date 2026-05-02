import type { EnqueueOptions, PersistedJob, ScheduleOptions } from '@/jobs';

import { JobIntake } from './job-intake.js';
import type { SchedulerContext } from './types.js';

/**
 * Internal service for job scheduling operations.
 *
 * Handles enqueueing new jobs, immediate dispatch, and cron scheduling.
 * All operations are atomic and support deduplication via uniqueKey.
 *
 * @internal Not part of public API - use Monque class methods instead.
 */
export class JobScheduler {
	private readonly intake: JobIntake;

	constructor(ctx: SchedulerContext) {
		this.intake = new JobIntake(ctx);
	}

	/**
	 * Enqueue a job for processing.
	 *
	 * Jobs are stored in MongoDB and processed by registered workers. Supports
	 * delayed execution via `runAt` and deduplication via `uniqueKey`.
	 *
	 * When a `uniqueKey` is provided, only one pending or processing job with that key
	 * can exist. Completed or failed jobs don't block new jobs with the same key.
	 *
	 * Failed jobs are automatically retried with exponential backoff up to `maxRetries`
	 * (default: 10 attempts). The delay between retries is calculated as `2^failCount × baseRetryInterval`.
	 *
	 * @template T - The job data payload type (must be JSON-serializable)
	 * @param name - Job type identifier, must match a registered worker
	 * @param data - Job payload, will be passed to the worker handler
	 * @param options - Scheduling and deduplication options
	 * @returns Promise resolving to the created or existing job document
	 * @throws {InvalidJobIdentifierError} If `name` or `uniqueKey` fails public identifier validation
	 * @throws {ConnectionError} If database operation fails or scheduler not initialized
	 * @throws {PayloadTooLargeError} If payload exceeds configured `maxPayloadSize`
	 *
	 * @example Basic job enqueueing
	 * ```typescript
	 * await monque.enqueue('send-email', {
	 *   to: 'user@example.com',
	 *   subject: 'Welcome!',
	 *   body: 'Thanks for signing up.'
	 * });
	 * ```
	 *
	 * @example Delayed execution
	 * ```typescript
	 * const oneHourLater = new Date(Date.now() + 3600000);
	 * await monque.enqueue('reminder', { message: 'Check in!' }, {
	 *   runAt: oneHourLater
	 * });
	 * ```
	 *
	 * @example Prevent duplicates with unique key
	 * ```typescript
	 * await monque.enqueue('sync-user', { userId: '123' }, {
	 *   uniqueKey: 'sync-user-123'
	 * });
	 * // Subsequent enqueues with same uniqueKey return existing pending/processing job
	 * ```
	 */
	async enqueue<T>(name: string, data: T, options: EnqueueOptions = {}): Promise<PersistedJob<T>> {
		return this.intake.enqueue(name, data, options);
	}

	/**
	 * Enqueue a job for immediate processing.
	 *
	 * Convenience method equivalent to `enqueue(name, data, { runAt: new Date() })`.
	 * Jobs are picked up on the next poll cycle (typically within 1 second based on `pollInterval`).
	 *
	 * @template T - The job data payload type (must be JSON-serializable)
	 * @param name - Job type identifier, must match a registered worker
	 * @param data - Job payload, will be passed to the worker handler
	 * @returns Promise resolving to the created job document
	 * @throws {ConnectionError} If database operation fails or scheduler not initialized
	 *
	 * @example Send email immediately
	 * ```typescript
	 * await monque.now('send-email', {
	 *   to: 'admin@example.com',
	 *   subject: 'Alert',
	 *   body: 'Immediate attention required'
	 * });
	 * ```
	 *
	 * @example Process order in background
	 * ```typescript
	 * const order = await createOrder(data);
	 * await monque.now('process-order', { orderId: order.id });
	 * return order; // Return immediately, processing happens async
	 * ```
	 */
	async now<T>(name: string, data: T): Promise<PersistedJob<T>> {
		return this.enqueue(name, data, { runAt: new Date() });
	}

	/**
	 * Schedule a recurring job with a cron expression.
	 *
	 * Creates a job that automatically re-schedules itself based on the cron pattern.
	 * Uses standard 5-field cron format: minute, hour, day of month, month, day of week.
	 * Also supports predefined expressions like `@daily`, `@weekly`, `@monthly`, etc.
	 * After successful completion, the job is reset to `pending` status and scheduled
	 * for its next run based on the cron expression.
	 *
	 * When a `uniqueKey` is provided, only one pending or processing job with that key
	 * can exist. This prevents duplicate scheduled jobs on application restart.
	 *
	 * @template T - The job data payload type (must be JSON-serializable)
	 * @param cron - Cron expression (5 fields or predefined expression)
	 * @param name - Job type identifier, must match a registered worker
	 * @param data - Job payload, will be passed to the worker handler on each run
	 * @param options - Scheduling options (uniqueKey for deduplication)
	 * @returns Promise resolving to the created job document with `repeatInterval` set
	 * @throws {InvalidJobIdentifierError} If `name` or `uniqueKey` fails public identifier validation
	 * @throws {InvalidCronError} If cron expression is invalid
	 * @throws {ConnectionError} If database operation fails or scheduler not initialized
	 * @throws {PayloadTooLargeError} If payload exceeds configured `maxPayloadSize`
	 *
	 * @example Hourly cleanup job
	 * ```typescript
	 * await monque.schedule('0 * * * *', 'cleanup-temp-files', {
	 *   directory: '/tmp/uploads'
	 * });
	 * ```
	 *
	 * @example Prevent duplicate scheduled jobs with unique key
	 * ```typescript
	 * await monque.schedule('0 * * * *', 'hourly-report', { type: 'sales' }, {
	 *   uniqueKey: 'hourly-report-sales'
	 * });
	 * // Subsequent calls with same uniqueKey return existing pending/processing job
	 * ```
	 *
	 * @example Daily report at midnight (using predefined expression)
	 * ```typescript
	 * await monque.schedule('@daily', 'daily-report', {
	 *   reportType: 'sales',
	 *   recipients: ['analytics@example.com']
	 * });
	 * ```
	 */
	async schedule<T>(
		cron: string,
		name: string,
		data: T,
		options: ScheduleOptions = {},
	): Promise<PersistedJob<T>> {
		return this.intake.schedule(cron, name, data, options);
	}
}
