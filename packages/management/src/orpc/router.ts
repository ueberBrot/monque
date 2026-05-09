import { implement, ORPCError, type Router } from '@orpc/server';

import type { ManagementOpenApiContext, ManagementOptions } from '../surface/index.js';
import type { ManagementContract } from './contract.js';
import { managementContract } from './contract.js';
import { createManagementOperations } from './operations.js';

/** oRPC router type returned by `createManagementRouter()`. */
export type ManagementRouter<TContext = unknown> = Router<
	ManagementContract,
	ManagementOpenApiContext<TContext>
>;

function requiresOpenApiManagementContext<TContext>(options: ManagementOptions<TContext>): boolean {
	return (
		options.authorize !== undefined ||
		options.serializePayload !== undefined ||
		(options.serializePayloadByJobName !== undefined &&
			Object.keys(options.serializePayloadByJobName).length > 0)
	);
}

/**
 * Create an oRPC router that implements the management contract.
 *
 * Use this when integrating with oRPC directly. For a framework-neutral fetch handler,
 * prefer `createManagementSurface()`.
 */
export function createManagementRouter<TContext = unknown>(
	options: ManagementOptions<TContext>,
): ManagementRouter<TContext> {
	const managementImplementer =
		implement(managementContract).$context<ManagementOpenApiContext<TContext>>();
	const operations = createManagementOperations(options);
	const requireContext = requiresOpenApiManagementContext(options);

	return managementImplementer.router({
		health: managementImplementer.health.handler(() => operations.getHealth()),
		capabilities: managementImplementer.capabilities.handler(({ context }) =>
			operations.getCapabilities(getOpenApiManagementContext(context, requireContext)),
		),
		queueViews: managementImplementer.queueViews.handler(({ context }) =>
			operations.listQueueViews(getOpenApiManagementContext(context, requireContext)),
		),
		jobs: managementImplementer.jobs.handler(({ input, context }) =>
			operations.listJobs(input, getOpenApiManagementContext(context, requireContext)),
		),
		jobStats: managementImplementer.jobStats.handler(({ input, context }) =>
			operations.getJobStats(input, getOpenApiManagementContext(context, requireContext)),
		),
		job: managementImplementer.job.handler(({ input, context }) =>
			operations.getJob(input, getOpenApiManagementContext(context, requireContext)),
		),
		cancelJob: managementImplementer.cancelJob.handler(({ input, context }) =>
			operations.cancelJob(input, getOpenApiManagementContext(context, requireContext)),
		),
		retryJob: managementImplementer.retryJob.handler(({ input, context }) =>
			operations.retryJob(input, getOpenApiManagementContext(context, requireContext)),
		),
		rescheduleJob: managementImplementer.rescheduleJob.handler(({ input, context }) =>
			operations.rescheduleJob(input, getOpenApiManagementContext(context, requireContext)),
		),
		deleteJob: managementImplementer.deleteJob.handler(({ input, context }) =>
			operations.deleteJob(input, getOpenApiManagementContext(context, requireContext)),
		),
		cancelJobs: managementImplementer.cancelJobs.handler(({ input, context }) =>
			operations.cancelJobs(input, getOpenApiManagementContext(context, requireContext)),
		),
		retryJobs: managementImplementer.retryJobs.handler(({ input, context }) =>
			operations.retryJobs(input, getOpenApiManagementContext(context, requireContext)),
		),
		deleteJobs: managementImplementer.deleteJobs.handler(({ input, context }) =>
			operations.deleteJobs(input, getOpenApiManagementContext(context, requireContext)),
		),
	});
}

function getOpenApiManagementContext<TContext>(
	context: ManagementOpenApiContext<TContext>,
	requireContext: boolean,
): TContext {
	if (requireContext && context.managementContext === undefined) {
		throw new ORPCError('INTERNAL_SERVER_ERROR', {
			message:
				'Missing managementContext in openApiHandler.handle() context; managementContext is required for authorize/serializePayload hooks.',
		});
	}

	return context.managementContext as TContext;
}
