import type { Job, JobStatusType, PersistedJob } from './types.js';
import { JobStatus } from './types.js';

/**
 * Type guard to check if a job has been persisted to MongoDB.
 *
 * A persisted job is guaranteed to have an `_id` field, which means it has been
 * successfully inserted into the database. This is useful when you need to ensure
 * a job can be updated or referenced by its ID.
 *
 * @template T - The type of the job's data payload
 * @param job - The job to check
 * @returns `true` if the job has a valid `_id`, narrowing the type to `PersistedJob<T>`
 *
 * @example Basic usage
 * ```typescript
 * const job: Job<EmailData> = await monque.enqueue('send-email', emailData);
 *
 * if (isPersistedJob(job)) {
 *   // TypeScript knows job._id exists
 *   console.log(`Job ID: ${job._id.toString()}`);
 * }
 * ```
 *
 * @example In a conditional
 * ```typescript
 * function logJobId(job: Job) {
 *   if (!isPersistedJob(job)) {
 *     console.log('Job not yet persisted');
 *     return;
 *   }
 *   // TypeScript knows job is PersistedJob here
 *   console.log(`Processing job ${job._id.toString()}`);
 * }
 * ```
 */
export function isPersistedJob<T>(job: Job<T>): job is PersistedJob<T> {
	return '_id' in job && job._id !== undefined && job._id !== null;
}

/**
 * Type guard to check if a value is a valid job status.
 *
 * Validates that a value is one of the four valid job statuses: `'pending'`,
 * `'processing'`, `'completed'`, or `'failed'`. Useful for runtime validation
 * of user input or external data.
 *
 * @param value - The value to check
 * @returns `true` if the value is a valid `JobStatusType`, narrowing the type
 *
 * @example Validating user input
 * ```typescript
 * function filterByStatus(status: string) {
 *   if (!isValidJobStatus(status)) {
 *     throw new Error(`Invalid status: ${status}`);
 *   }
 *   // TypeScript knows status is JobStatusType here
 *   return db.jobs.find({ status });
 * }
 * ```
 *
 * @example Runtime validation
 * ```typescript
 * const statusFromApi = externalData.status;
 *
 * if (isValidJobStatus(statusFromApi)) {
 *   job.status = statusFromApi;
 * } else {
 *   job.status = JobStatus.PENDING;
 * }
 * ```
 */
export function isValidJobStatus(value: unknown): value is JobStatusType {
	return typeof value === 'string' && Object.values(JobStatus).includes(value as JobStatusType);
}

/**
 * Type guard to check if a job is in pending status.
 *
 * A convenience helper for checking if a job is waiting to be processed.
 * Equivalent to `job.status === JobStatus.PENDING` but with better semantics.
 *
 * @template T - The type of the job's data payload
 * @param job - The job to check
 * @returns `true` if the job status is `'pending'`
 *
 * @example Filter pending jobs
 * ```typescript
 * const jobs = await monque.getJobs();
 * const pendingJobs = jobs.filter(isPendingJob);
 * console.log(`${pendingJobs.length} jobs waiting to be processed`);
 * ```
 *
 * @example Conditional logic
 * ```typescript
 * if (isPendingJob(job)) {
 *   await monque.now(job.name, job.data);
 * }
 * ```
 */
export function isPendingJob<T>(job: Job<T>): boolean {
	return job.status === JobStatus.PENDING;
}

/**
 * Type guard to check if a job is currently being processed.
 *
 * A convenience helper for checking if a job is actively running.
 * Equivalent to `job.status === JobStatus.PROCESSING` but with better semantics.
 *
 * @template T - The type of the job's data payload
 * @param job - The job to check
 * @returns `true` if the job status is `'processing'`
 *
 * @example Monitor active jobs
 * ```typescript
 * const jobs = await monque.getJobs();
 * const activeJobs = jobs.filter(isProcessingJob);
 * console.log(`${activeJobs.length} jobs currently running`);
 * ```
 */
export function isProcessingJob<T>(job: Job<T>): boolean {
	return job.status === JobStatus.PROCESSING;
}

/**
 * Type guard to check if a job has completed successfully.
 *
 * A convenience helper for checking if a job finished without errors.
 * Equivalent to `job.status === JobStatus.COMPLETED` but with better semantics.
 *
 * @template T - The type of the job's data payload
 * @param job - The job to check
 * @returns `true` if the job status is `'completed'`
 *
 * @example Find completed jobs
 * ```typescript
 * const jobs = await monque.getJobs();
 * const completedJobs = jobs.filter(isCompletedJob);
 * console.log(`${completedJobs.length} jobs completed successfully`);
 * ```
 */
export function isCompletedJob<T>(job: Job<T>): boolean {
	return job.status === JobStatus.COMPLETED;
}

/**
 * Type guard to check if a job has permanently failed.
 *
 * A convenience helper for checking if a job exhausted all retries.
 * Equivalent to `job.status === JobStatus.FAILED` but with better semantics.
 *
 * @template T - The type of the job's data payload
 * @param job - The job to check
 * @returns `true` if the job status is `'failed'`
 *
 * @example Handle failed jobs
 * ```typescript
 * const jobs = await monque.getJobs();
 * const failedJobs = jobs.filter(isFailedJob);
 *
 * for (const job of failedJobs) {
 *   console.error(`Job ${job.name} failed: ${job.failReason}`);
 *   await sendAlert(job);
 * }
 * ```
 */
export function isFailedJob<T>(job: Job<T>): boolean {
	return job.status === JobStatus.FAILED;
}

/**
 * Type guard to check if a job is a recurring scheduled job.
 *
 * A recurring job has a `repeatInterval` cron expression and will be automatically
 * rescheduled after each successful completion.
 *
 * @template T - The type of the job's data payload
 * @param job - The job to check
 * @returns `true` if the job has a `repeatInterval` defined
 *
 * @example Filter recurring jobs
 * ```typescript
 * const jobs = await monque.getJobs();
 * const recurringJobs = jobs.filter(isRecurringJob);
 * console.log(`${recurringJobs.length} jobs will repeat automatically`);
 * ```
 *
 * @example Conditional cleanup
 * ```typescript
 * if (!isRecurringJob(job) && isCompletedJob(job)) {
 *   // Safe to delete one-time completed jobs
 *   await deleteJob(job._id);
 * }
 * ```
 */
export function isRecurringJob<T>(job: Job<T>): boolean {
	return job.repeatInterval !== undefined && job.repeatInterval !== null;
}
