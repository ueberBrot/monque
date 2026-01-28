/**
 * Collect job metadata utility
 *
 * Collects all job metadata from a class decorated with @JobController.
 * Used by MonqueModule to discover and register all jobs.
 */
import { Store } from '@tsed/core';

import { MONQUE } from '@/constants';
import type { CronDecoratorOptions, JobDecoratorOptions, JobStore } from '@/decorators';

import { buildJobName } from './build-job-name.js';

/**
 * Collected job registration info ready for Monque.register()
 */
export interface CollectedJobMetadata {
	/**
	 * Full job name (with namespace prefix if applicable)
	 */
	fullName: string;

	/**
	 * Method name on the controller class
	 */
	method: string;

	/**
	 * Job options to pass to Monque.register()
	 */
	opts: JobDecoratorOptions | CronDecoratorOptions;

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
 * Collect all job metadata from a class.
 *
 * @param target - The class constructor (decorated with @JobController)
 * @returns Array of collected job metadata ready for registration
 *
 * @example
 * ```typescript
 * const metadata = collectJobMetadata(EmailJobs);
 * // Returns:
 * // [
 * //   { fullName: "email.send", method: "sendEmail", opts: {}, isCron: false },
 * //   { fullName: "email.daily-digest", method: "sendDailyDigest", opts: {}, isCron: true, cronPattern: "0 9 * * *" }
 * // ]
 * ```
 */
export function collectJobMetadata(
	target: new (...args: unknown[]) => unknown,
): CollectedJobMetadata[] {
	const store = Store.from(target);
	const jobStore = store.get<JobStore>(MONQUE);

	if (!jobStore) {
		return [];
	}

	const results: CollectedJobMetadata[] = [];
	const namespace = jobStore.namespace;

	// Collect regular jobs
	for (const job of jobStore.jobs) {
		results.push({
			fullName: buildJobName(namespace, job.name),
			method: job.method,
			opts: job.opts,
			isCron: false,
		});
	}

	// Collect cron jobs
	for (const cron of jobStore.cronJobs) {
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
