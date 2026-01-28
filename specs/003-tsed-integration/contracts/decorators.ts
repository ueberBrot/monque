/**
 * @monque/tsed - Decorator Contracts
 *
 * These interfaces define the public API for all decorators exposed by @monque/tsed.
 */

import type { WorkerOptions as CoreWorkerOptions, ScheduleOptions } from '@monque/core';

// ─────────────────────────────────────────────────────────────────────────────
// @JobController
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decorator signature for @JobController.
 *
 * Marks a class as containing job methods and registers it with the DI container.
 *
 * @param namespace - Optional prefix for all job names in this controller.
 *                    When set, job names become "{namespace}.{name}".
 *
 * @example
 * ```typescript
 * @JobController("email")
 * export class EmailJobs {
 *   @Job("send")  // Registered as "email.send"
 *   async send(job: Job<EmailPayload>) { }
 * }
 * ```
 */
export type JobControllerDecorator = (namespace?: string) => ClassDecorator;

// ─────────────────────────────────────────────────────────────────────────────
// @Job
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for the @Job method decorator.
 *
 * Maps to @monque/core WorkerOptions. All standard Monque worker options
 * are exposed here for decorator-based configuration (SC-002).
 */
export interface JobDecoratorOptions extends CoreWorkerOptions {}

/**
 * Decorator signature for @Job.
 *
 * Registers a method as a job handler. The method will be called when a job
 * with the matching name is picked up for processing.
 *
 * @param name - Job name (combined with controller namespace if present).
 * @param options - Job configuration options.
 *
 * @example
 * ```typescript
 * @JobController("notifications")
 * export class NotificationJobs {
 *   @Job("push", { concurrency: 10 })
 *   async sendPush(job: Job<PushPayload>) {
 *     await pushService.send(job.data);
 *   }
 * }
 * ```
 */
export type JobDecorator = (name: string, options?: JobDecoratorOptions) => MethodDecorator;

// ─────────────────────────────────────────────────────────────────────────────
// @Cron
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

/**
 * Decorator signature for @Cron.
 *
 * Registers a method as a scheduled cron job handler. The job is automatically
 * scheduled during module initialization and re-scheduled after each execution.
 *
 * @param pattern - Cron expression (5-field standard or predefined like @daily).
 * @param options - Schedule and naming options.
 *
 * @example
 * ```typescript
 * @JobController("reports")
 * export class ReportJobs {
 *   @Cron("0 9 * * *", { name: "daily-summary" })
 *   async generateDailySummary(job: Job) {
 *     // Runs at 9am daily, registered as "reports.daily-summary"
 *   }
 * }
 * ```
 */
export type CronDecorator = (pattern: string, options?: CronDecoratorOptions) => MethodDecorator;
