import type { Job } from '@monque/core';

/**
 * Interface that must be implemented by Job handlers
 */
export interface JobMethods<T = unknown> {
	/**
	 * Handle the job execution
	 * @param data The job data payload
	 * @param job The full job object
	 */
	handle(data: T, job: Job<T>): Promise<void> | void;
}
