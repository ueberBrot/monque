/**
 * @Worker method decorator
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
import { Store } from '@tsed/core';

import { MONQUE } from '@/constants';

import type { WorkerDecoratorOptions, WorkerMetadata, WorkerStore } from './types.js';

/**
 * Method decorator that registers a method as a job handler.
 *
 * @param name - The job name (will be prefixed with controller namespace if present)
 * @param options - Optional worker configuration (concurrency, replace, etc.)
 */
export function Worker(name: string, options?: WorkerDecoratorOptions): MethodDecorator {
	return <T>(
		target: object,
		propertyKey: string | symbol,
		_descriptor: TypedPropertyDescriptor<T>,
	): void => {
		const methodName = String(propertyKey);

		const workerMetadata: WorkerMetadata = {
			name,
			method: methodName,
			opts: options || {},
		};

		// Get the class constructor (target is the prototype for instance methods)
		const targetConstructor = target.constructor;
		const store = Store.from(targetConstructor);

		// Get or initialize the MONQUE store
		const existing = store.get<Partial<WorkerStore>>(MONQUE) || {
			type: 'controller',
			workers: [],
			cronJobs: [],
		};

		// Add this worker to the list
		const workers = [...(existing.workers || []), workerMetadata];

		store.set(MONQUE, {
			...existing,
			workers,
		});
	};
}
