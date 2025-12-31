import type { EnqueueOptions } from '@monque/core';

/**
 * Options for the @Job decorator
 */
export interface JobOptions extends Partial<EnqueueOptions> {
	/**
	 * Custom DI token for the job provider.
	 * If not specified, defaults to `monque:job:${name}`
	 */
	token?: string;
}
