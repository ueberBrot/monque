import { implement } from '@orpc/server';

import { toQueueViewSummaryListDto, toSchedulerHealthDto } from '../dtos/index.js';
import { getManagementCapabilities } from '../surface/capabilities.js';
import type { ManagementOpenApiContext, ManagementOptions } from '../surface/index.js';
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
		queueViews: managementImplementer.queueViews.handler(async () =>
			toQueueViewSummaryListDto(await options.monque.getQueueViewSummaries()),
		),
	});
}

export type ManagementRouter = ReturnType<typeof createManagementRouter>;
