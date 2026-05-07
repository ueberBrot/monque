import { implement, ORPCError } from '@orpc/server';

import { toQueueStatsDto, toQueueViewSummaryListDto, toSchedulerHealthDto } from '../dtos/index.js';
import { getManagementCapabilities } from '../surface/capabilities.js';
import type {
	ManagementAction,
	ManagementOpenApiContext,
	ManagementOptions,
} from '../surface/index.js';
import { managementContract } from './contract.js';

export function createManagementRouter<TContext = unknown>(options: ManagementOptions<TContext>) {
	const managementImplementer =
		implement(managementContract).$context<ManagementOpenApiContext<TContext>>();

	return managementImplementer.router({
		health: managementImplementer.health.handler(() =>
			toSchedulerHealthDto(options.monque.isHealthy()),
		),
		capabilities: managementImplementer.capabilities.handler(({ context }) =>
			getManagementCapabilities(options, context.managementContext as TContext),
		),
		queueViews: managementImplementer.queueViews.handler(async ({ context }) => {
			await requireReadAuthorization(options, context.managementContext as TContext);

			return toQueueViewSummaryListDto(await options.monque.getQueueViewSummaries());
		}),
		jobStats: managementImplementer.jobStats.handler(async ({ input, context }) => {
			await requireReadAuthorization(options, context.managementContext as TContext);

			return toQueueStatsDto(
				await options.monque.getQueueStats(
					input.name === undefined ? undefined : { name: input.name },
				),
			);
		}),
	});
}

export type ManagementRouter = ReturnType<typeof createManagementRouter>;

async function requireReadAuthorization<TContext>(
	options: ManagementOptions<TContext>,
	context: TContext,
): Promise<void> {
	if (await isAllowedByAuthorization(options, 'read', context)) {
		return;
	}

	throw new ORPCError('FORBIDDEN', { message: 'Read access denied' });
}

async function isAllowedByAuthorization<TContext>(
	options: ManagementOptions<TContext>,
	action: ManagementAction,
	context: TContext,
): Promise<boolean> {
	if (!options.authorize) {
		return true;
	}

	return options.authorize({ action, context });
}
