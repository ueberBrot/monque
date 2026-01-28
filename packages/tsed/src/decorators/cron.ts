import { Store } from '@tsed/core';

import { MONQUE } from '@/constants';
import type { CronDecoratorOptions, CronMetadata, JobStore } from '@/decorators/types.js';

/**
 * Method decorator that registers a method as a scheduled cron job.
 *
 * @param pattern - Cron expression (e.g., "* * * * *", "@daily")
 * @param options - Optional cron configuration (name, timezone, etc.)
 *
 * @example
 * ```typescript
 * @JobController()
 * class ReportJobs {
 *   @Cron("@daily", { timezone: "UTC" })
 *   async generateDailyReport() {
 *     // ...
 *   }
 * }
 * ```
 */
export function Cron(pattern: string, options?: CronDecoratorOptions): MethodDecorator {
	return <T>(
		target: object,
		propertyKey: string | symbol,
		_descriptor: TypedPropertyDescriptor<T>,
	): void => {
		const methodName = String(propertyKey);

		const cronMetadata: CronMetadata = {
			pattern,
			// Default name to method name if not provided
			name: options?.name || methodName,
			method: methodName,
			opts: options || {},
		};

		// Get the class constructor (target is the prototype for instance methods)
		const targetConstructor = target.constructor;
		const store = Store.from(targetConstructor);

		// Get or initialize the MONQUE store
		const existing = store.get<Partial<JobStore>>(MONQUE) || {
			type: 'controller',
			jobs: [],
			cronJobs: [],
		};

		// Add this cron job to the list
		const cronJobs = [...(existing.cronJobs || []), cronMetadata];

		store.set(MONQUE, {
			...existing,
			cronJobs,
		});
	};
}
