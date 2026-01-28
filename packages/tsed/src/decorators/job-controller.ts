/**
 * @JobController class decorator
 *
 * Marks a class as containing job methods and registers it with the Ts.ED DI container.
 * Jobs in the class will have their job names prefixed with the namespace.
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
import { Store, useDecorators } from '@tsed/core';
import { Injectable } from '@tsed/di';

import { MONQUE, ProviderTypes } from '@/constants';

import type { JobStore } from './types.js';

/**
 * Class decorator that registers a class as a job controller.
 *
 * @param namespace - Optional namespace prefix for job names
 */
export function JobController(namespace?: string): ClassDecorator {
	return useDecorators(
		// Register as injectable with custom provider type
		Injectable({
			type: ProviderTypes.JOB_CONTROLLER,
		}),
		// Apply custom decorator to store metadata
		(target: object) => {
			const store = Store.from(target);

			// Get existing store or create new one
			const existing = store.get<Partial<JobStore>>(MONQUE) || {};

			// Merge with new metadata, only include namespace if defined
			const jobStore: JobStore = {
				type: 'controller',
				...(namespace !== undefined && { namespace }),
				jobs: existing.jobs || [],
				cronJobs: existing.cronJobs || [],
			};

			store.set(MONQUE, jobStore);
		},
	);
}
