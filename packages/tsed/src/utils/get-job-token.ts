/**
 * Generate a unique token for a job controller.
 *
 * Used internally by Ts.ED DI to identify job controller providers.
 * The token is based on the class name for debugging purposes.
 *
 * @param target - The class constructor
 * @returns A Symbol token unique to this job controller
 *
 * @example
 * ```typescript
 * @JobController("email")
 * class EmailJobs {}
 *
 * const token = getJobToken(EmailJobs);
 * // Symbol("monque:job:EmailJobs")
 * ```
 */
import { MonqueError } from '@monque/core';

export function getJobToken(target: new (...args: unknown[]) => unknown): symbol {
	const name = target.name?.trim();

	if (!name) {
		throw new MonqueError('Job class must have a non-empty name');
	}

	return Symbol.for(`monque:job:${name}`);
}
