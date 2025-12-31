import { Store } from '@tsed/core';

import { MONQUE_METADATA } from '@/constants/constants.js';
import type { ControllerStore, CronOptions, MethodJobOptions } from '@/types.js';

/**
 * Method decorator that registers a controller method as a Monque job handler.
 *
 * Use this decorator on methods within a `@JobController` decorated class
 * to define job handlers. The method will be automatically registered
 * with the Monque scheduler when the module initializes.
 *
 * The decorated method can have any signature but typically receives:
 * - `data: T` - The job payload data
 * - `job: Job<T>` - The full job object from MongoDB
 *
 * @param name - The job name (will be prefixed with controller namespace if set)
 * @param options - Optional job configuration
 *
 * @example Basic usage
 * ```typescript
 * @JobController()
 * class EmailJobs {
 *   @Job('send-welcome')
 *   async sendWelcome(data: WelcomeData, job: Job<WelcomeData>) {
 *     await this.emailService.send(data.email, 'Welcome!');
 *   }
 * }
 * ```
 *
 * @example With concurrency limit
 * ```typescript
 * @JobController()
 * class VideoJobs {
 *   @Job('process-video', { concurrency: 2 })
 *   async processVideo(data: VideoData) {
 *     // Resource-intensive processing
 *   }
 * }
 * ```
 */
export function Job(name: string, options?: MethodJobOptions): MethodDecorator {
	return (target: object, propertyKey: string | symbol) => {
		const store: ControllerStore = {
			jobs: {
				[String(propertyKey)]: { name, options },
			},
		};
		Store.from(target).merge(MONQUE_METADATA, store);
	};
}

/**
 * Method decorator that registers a controller method as a cron-scheduled job.
 *
 * Use this decorator on methods within a `@JobController` decorated class
 * to define recurring jobs. The job will be automatically scheduled with
 * the Monque scheduler when the module initializes.
 *
 * By default, cron jobs use `{controllerClass}.{methodName}` as the unique key
 * to prevent duplicate scheduled jobs across restarts.
 *
 * @param expression - Cron expression (5-field format: minute hour day month weekday)
 * @param options - Optional job configuration
 *
 * @example Daily digest at 9 AM
 * ```typescript
 * @JobController({ namespace: 'notifications' })
 * class NotificationJobs {
 *   @Cron('0 9 * * *')  // 9:00 AM every day
 *   async sendDailyDigest(data: DigestData, job: Job<DigestData>) {
 *     await this.notificationService.sendDigest();
 *   }
 * }
 * ```
 *
 * @example Every 5 minutes with custom name
 * ```typescript
 * @JobController()
 * class CleanupJobs {
 *   @Cron('*\/5 * * * *', { name: 'temp-cleanup', concurrency: 1 })
 *   async cleanupTempFiles() {
 *     await this.cleanupService.cleanup();
 *   }
 * }
 * ```
 *
 * @example With custom unique key
 * ```typescript
 * @JobController()
 * class SyncJobs {
 *   @Cron('0 * * * *', { uniqueKey: 'hourly-sync-v2' })
 *   async syncData() {
 *     await this.syncService.sync();
 *   }
 * }
 * ```
 */
export function Cron(expression: string, options?: CronOptions): MethodDecorator {
	return (target: object, propertyKey: string | symbol) => {
		const store: ControllerStore = {
			cron: {
				[String(propertyKey)]: { expression, options },
			},
		};
		Store.from(target).merge(MONQUE_METADATA, store);
	};
}
