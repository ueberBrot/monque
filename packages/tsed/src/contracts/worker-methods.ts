/**
 * @monque/tsed - Worker Methods Interface
 *
 * Interface for controller methods that handle jobs.
 */

import type { Job } from '@monque/core';

// ─────────────────────────────────────────────────────────────────────────────
// Worker Methods Interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Interface for controller methods that handle jobs.
 *
 * Unlike `@tsed/bullmq`'s `JobMethods` which has a `handle(payload, job)` signature,
 * we pass the full `Job` object directly to align with `@monque/core`'s handler pattern.
 *
 * @typeParam T - Type of the job data payload
 * @typeParam R - Type of the return value (typically void or ignored)
 *
 * @example
 * ```typescript
 * @WorkerController("email")
 * class EmailWorkers {
 *   @Worker("send")
 *   async sendEmail(job: Job<EmailPayload>): Promise<void> {
 *     await mailer.send(job.data.to, job.data.subject, job.data.body);
 *   }
 * }
 * ```
 */
export interface WorkerMethods<T = unknown, R = unknown> {
	/**
	 * Handle a job execution.
	 * Called by MonqueModule when a job is picked up by the worker.
	 *
	 * @param job - The full job object including metadata
	 * @returns Result value (typically void or ignored)
	 */
	(job: Job<T>): R | Promise<R>;
}
