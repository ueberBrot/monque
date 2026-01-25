/**
 * @monque/tsed - Decorator Types
 */

import type { WorkerOptions as CoreWorkerOptions, Job, ScheduleOptions } from '@monque/core';

// ─────────────────────────────────────────────────────────────────────────────
// Worker Methods
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
export type WorkerMethods<T = unknown, R = unknown> = (job: Job<T>) => R | Promise<R>;

// ─────────────────────────────────────────────────────────────────────────────
// Worker Controller
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for the @WorkerController class decorator.
 * Reserved for future extensions.
 */
export type WorkerControllerOptions = Record<string, never>;

// ─────────────────────────────────────────────────────────────────────────────
// Worker Decorator Options
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for the @Worker method decorator.
 *
 * Maps to @monque/core WorkerOptions. All standard Monque worker options
 * are exposed here for decorator-based configuration.
 */
export interface WorkerDecoratorOptions extends CoreWorkerOptions {}

// ─────────────────────────────────────────────────────────────────────────────
// Worker Metadata
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Metadata for a single @Worker decorated method.
 *
 * Stored in the WorkerStore and used by MonqueModule to register workers.
 */
export interface WorkerMetadata {
	/**
	 * Job name (without namespace prefix).
	 * Combined with controller namespace to form full job name.
	 */
	name: string;

	/**
	 * Method name on the controller class.
	 */
	method: string;

	/**
	 * Worker options forwarded to Monque.register().
	 */
	opts: WorkerDecoratorOptions;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cron Decorator Options
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for the @Cron method decorator.
 *
 * Maps to @monque/core ScheduleOptions with additional metadata overrides.
 */
export interface CronDecoratorOptions extends ScheduleOptions {
	/**
	 * Override job name (defaults to method name).
	 */
	name?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cron Metadata
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Metadata for a single @Cron decorated method.
 *
 * Stored in the WorkerStore and used by MonqueModule to schedule cron jobs.
 */
export interface CronMetadata {
	/**
	 * Cron expression (5-field standard or predefined like @daily).
	 */
	pattern: string;

	/**
	 * Job name (defaults to method name if not specified in options).
	 */
	name: string;

	/**
	 * Method name on the controller class.
	 */
	method: string;

	/**
	 * Schedule options forwarded to Monque.schedule().
	 */
	opts: CronDecoratorOptions;
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker Store
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Complete metadata structure stored on @WorkerController classes.
 *
 * Accessed via `Store.from(Class).get(MONQUE)`.
 *
 * @example
 * ```typescript
 * const store = Store.from(EmailWorkers).get<WorkerStore>(MONQUE);
 * console.log(store.namespace); // "email"
 * console.log(store.workers); // [{ name: "send", method: "sendEmail", opts: {} }]
 * ```
 */
export interface WorkerStore {
	/**
	 * Type identifier for the store.
	 * Always "controller" for WorkerController.
	 */
	type: 'controller';

	/**
	 * Optional namespace prefix for all jobs in this controller.
	 * When set, job names become "{namespace}.{name}".
	 */
	namespace?: string;

	/**
	 * Worker method registrations from @Worker decorators.
	 */
	workers: WorkerMetadata[];

	/**
	 * Cron job registrations from @Cron decorators.
	 */
	cronJobs: CronMetadata[];
}
