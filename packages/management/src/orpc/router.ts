import { implement } from '@orpc/server';

import type { ManagementOpenApiContext, ManagementOptions } from '../surface/index.js';
import { managementContract } from './contract.js';
import { createManagementOperations } from './operations.js';

/**
 * Create an oRPC router that implements the management contract.
 *
 * Use this when integrating with oRPC directly. For a framework-neutral fetch handler,
 * prefer `createManagementSurface()`.
 */
export function createManagementRouter<TContext = unknown>(options: ManagementOptions<TContext>) {
	const managementImplementer =
		implement(managementContract).$context<ManagementOpenApiContext<TContext>>();
	const operations = createManagementOperations(options);

	return managementImplementer.router({
		health: managementImplementer.health.handler(() => operations.getHealth()),
		capabilities: managementImplementer.capabilities.handler(({ context }) =>
			operations.getCapabilities(getOpenApiManagementContext(context)),
		),
		queueViews: managementImplementer.queueViews.handler(({ context }) =>
			operations.listQueueViews(getOpenApiManagementContext(context)),
		),
		jobs: managementImplementer.jobs.handler(({ input, context }) =>
			operations.listJobs(input, getOpenApiManagementContext(context)),
		),
		jobStats: managementImplementer.jobStats.handler(({ input, context }) =>
			operations.getJobStats(input, getOpenApiManagementContext(context)),
		),
		job: managementImplementer.job.handler(({ input, context }) =>
			operations.getJob(input, getOpenApiManagementContext(context)),
		),
		cancelJob: managementImplementer.cancelJob.handler(({ input, context }) =>
			operations.cancelJob(input, getOpenApiManagementContext(context)),
		),
		retryJob: managementImplementer.retryJob.handler(({ input, context }) =>
			operations.retryJob(input, getOpenApiManagementContext(context)),
		),
		rescheduleJob: managementImplementer.rescheduleJob.handler(({ input, context }) =>
			operations.rescheduleJob(input, getOpenApiManagementContext(context)),
		),
		deleteJob: managementImplementer.deleteJob.handler(({ input, context }) =>
			operations.deleteJob(input, getOpenApiManagementContext(context)),
		),
		cancelJobs: managementImplementer.cancelJobs.handler(({ input, context }) =>
			operations.cancelJobs(input, getOpenApiManagementContext(context)),
		),
		retryJobs: managementImplementer.retryJobs.handler(({ input, context }) =>
			operations.retryJobs(input, getOpenApiManagementContext(context)),
		),
		deleteJobs: managementImplementer.deleteJobs.handler(({ input, context }) =>
			operations.deleteJobs(input, getOpenApiManagementContext(context)),
		),
	});
}

function getOpenApiManagementContext<TContext>(
	context: ManagementOpenApiContext<TContext>,
): TContext {
	return context.managementContext as TContext;
}

/** oRPC router type returned by `createManagementRouter()`. */
export type ManagementRouter = ReturnType<typeof createManagementRouter>;
