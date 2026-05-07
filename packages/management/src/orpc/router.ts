import { implement } from '@orpc/server';

import { toSchedulerHealthDto } from '../dtos/index.js';
import type { ManagementOptions } from '../surface/index.js';
import { managementContract } from './contract.js';

const managementImplementer = implement(managementContract);

export function createManagementRouter<TContext = unknown>(options: ManagementOptions<TContext>) {
	return managementImplementer.router({
		health: managementImplementer.health.handler(() =>
			toSchedulerHealthDto(options.monque.isHealthy()),
		),
	});
}

export type ManagementRouter = ReturnType<typeof createManagementRouter>;
