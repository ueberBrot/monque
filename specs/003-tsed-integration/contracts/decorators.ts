/**
 * @monque/tsed - Decorator Contracts
 *
 * These interfaces define the public API for all decorators exposed by @monque/tsed.
 */

import type { WorkerOptions as CoreWorkerOptions, ScheduleOptions } from '@monque/core';

// ─────────────────────────────────────────────────────────────────────────────
// @WorkerController
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for the @WorkerController class decorator.
 */
export type WorkerControllerOptions = {};

/**
 * Decorator signature for @WorkerController.
 *
 * Marks a class as containing worker methods and registers it with the DI container.
 *
 * @param namespace - Optional prefix for all job names in this controller.
 *                    When set, job names become "{namespace}.{name}".
 * @param options - Reserved for future options.
 *
 * @example
 * ```typescript
 * @WorkerController("email")
 * export class EmailWorkers {
 *   @Worker("send")  // Registered as "email.send"
 *   async send(job: Job<EmailPayload>) { }
 * }
 * ```
 */
export type WorkerControllerDecorator = (
	namespace?: string,
	options?: WorkerControllerOptions,
) => ClassDecorator;

// ─────────────────────────────────────────────────────────────────────────────
// @Worker
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for the @Worker method decorator.
 */
export interface WorkerDecoratorOptions extends Pick<CoreWorkerOptions, 'concurrency'> {
	/**
	 * Maximum concurrent jobs for this worker.
	 * Overrides the default concurrency from MonqueOptions.
	 */
	concurrency?: number;
}

/**
 * Decorator signature for @Worker.
 *
 * Registers a method as a job handler. The method will be called when a job
 * with the matching name is picked up for processing.
 *
 * @param name - Job name (combined with controller namespace if present).
 * @param options - Worker configuration options.
 *
 * @example
 * ```typescript
 * @WorkerController("notifications")
 * export class NotificationWorkers {
 *   @Worker("push", { concurrency: 10 })
 *   async sendPush(job: Job<PushPayload>) {
 *     await pushService.send(job.data);
 *   }
 * }
 * ```
 */
export type WorkerDecorator = (name: string, options?: WorkerDecoratorOptions) => MethodDecorator;

// ─────────────────────────────────────────────────────────────────────────────
// @Cron
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for the @Cron method decorator.
 */
export interface CronDecoratorOptions extends ScheduleOptions {
	/**
	 * Override the job name. Defaults to the method name.
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
 * @WorkerController("reports")
 * export class ReportWorkers {
 *   @Cron("0 9 * * *", { name: "daily-summary" })
 *   async generateDailySummary(job: Job) {
 *     // Runs at 9am daily, registered as "reports.daily-summary"
 *   }
 * }
 * ```
 */
export type CronDecorator = (pattern: string, options?: CronDecoratorOptions) => MethodDecorator;

// ─────────────────────────────────────────────────────────────────────────────
// @InjectMonque
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decorator signature for @InjectMonque.
 *
 * Convenience decorator for injecting the MonqueService instance.
 * Equivalent to @Inject(MonqueService).
 *
 * @example
 * ```typescript
 * @Service()
 * export class UserService {
 *   @InjectMonque()
 *   private monque: MonqueService;
 *
 *   async createUser(data: CreateUserDto) {
 *     const user = await this.save(data);
 *     await this.monque.enqueue("email.send-welcome", { userId: user.id });
 *     return user;
 *   }
 * }
 * ```
 */
export type InjectMonqueDecorator = () => PropertyDecorator;
