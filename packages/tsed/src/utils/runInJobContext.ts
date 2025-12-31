import { randomUUID } from 'node:crypto';
import type { Job } from '@monque/core';
import { DIContext, runInContext } from '@tsed/di';

/**
 * Executes a function within a fresh DI context for a job.
 *
 * @param job - The job being processed
 * @param work - The async function to execute within the context
 */
export async function runInJobContext<T>(job: Job<T>, work: () => Promise<void>): Promise<void> {
	const $ctx = new DIContext({
		id: job._id?.toString() ?? randomUUID(),
		additionalProps: {
			jobName: job.name,
			jobId: job._id?.toString(),
		},
	});

	$ctx.set('MONQUE_JOB', job);

	try {
		await runInContext($ctx, work);
	} finally {
		await $ctx.destroy();
	}
}
