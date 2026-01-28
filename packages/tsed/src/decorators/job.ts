/**
 * @Job method decorator
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
import { Store } from '@tsed/core';

import { MONQUE } from '@/constants';

import type { JobDecoratorOptions, JobMetadata, JobStore } from './types.js';

/**
 * Method decorator that registers a method as a job handler.
 *
 * @param name - The job name (will be prefixed with controller namespace if present)
 * @param options - Optional job configuration (concurrency, replace, etc.)
 */
export function Job(name: string, options?: JobDecoratorOptions): MethodDecorator {
	return <T>(
		target: object,
		propertyKey: string | symbol,
		_descriptor: TypedPropertyDescriptor<T>,
	): void => {
		const methodName = String(propertyKey);

		const jobMetadata: JobMetadata = {
			name,
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

		// Add this job to the list
		const jobs = [...(existing.jobs || []), jobMetadata];

		store.set(MONQUE, {
			...existing,
			jobs,
		});
	};
}
