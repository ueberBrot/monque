/**
 * Collect worker metadata utility
 *
 * Collects all worker metadata from a class decorated with @WorkerController.
 * Used by MonqueModule to discover and register all workers.
 */
import { Store } from '@tsed/core';

import { MONQUE } from '@/constants';
import type { CronDecoratorOptions, WorkerDecoratorOptions, WorkerStore } from '@/decorators';

import { buildJobName } from './build-job-name.js';

/**
 * Collected worker registration info ready for Monque.register()
 */
export interface CollectedWorkerMetadata {
	/**
	 * Full job name (with namespace prefix if applicable)
	 */
	fullName: string;

	/**
	 * Method name on the controller class
	 */
	method: string;

	/**
	 * Worker options to pass to Monque.register()
	 */
	opts: WorkerDecoratorOptions | CronDecoratorOptions;

	/**
	 * Whether this is a cron job
	 */
	isCron: boolean;

	/**
	 * Cron pattern (only for cron jobs)
	 */
	cronPattern?: string;
}

/**
 * Collect all worker metadata from a class.
 *
 * @param target - The class constructor (decorated with @WorkerController)
 * @returns Array of collected worker metadata ready for registration
 *
 * @example
 * ```typescript
 * const metadata = collectWorkerMetadata(EmailWorkers);
 * // Returns:
 * // [
 * //   { fullName: "email.send", method: "sendEmail", opts: {}, isCron: false },
 * //   { fullName: "email.daily-digest", method: "sendDailyDigest", opts: {}, isCron: true, cronPattern: "0 9 * * *" }
 * // ]
 * ```
 */
export function collectWorkerMetadata(
	target: new (...args: unknown[]) => unknown,
): CollectedWorkerMetadata[] {
	const store = Store.from(target);
	const workerStore = store.get<WorkerStore>(MONQUE);

	if (!workerStore) {
		return [];
	}

	const results: CollectedWorkerMetadata[] = [];
	const namespace = workerStore.namespace;

	// Collect regular workers
	for (const worker of workerStore.workers) {
		results.push({
			fullName: buildJobName(namespace, worker.name),
			method: worker.method,
			opts: worker.opts,
			isCron: false,
		});
	}

	// Collect cron jobs
	for (const cron of workerStore.cronJobs) {
		results.push({
			fullName: buildJobName(namespace, cron.name),
			method: cron.method,
			opts: cron.opts,
			isCron: true,
			cronPattern: cron.pattern,
		});
	}

	return results;
}
