import { oc } from '@orpc/contract';

import { CapabilitiesDtoSchema, SchedulerHealthDtoSchema } from '../schemas/index.js';

export const managementContract = {
	health: oc
		.route({
			method: 'GET',
			path: '/api/v1/health',
			operationId: 'getSchedulerHealth',
			successStatus: 200,
			successDescription: 'Successful response',
		})
		.output(SchedulerHealthDtoSchema),
	capabilities: oc
		.route({
			method: 'GET',
			path: '/api/v1/capabilities',
			operationId: 'getCapabilities',
			successStatus: 200,
			successDescription: 'Successful response',
		})
		.output(CapabilitiesDtoSchema),
};

export type ManagementContract = typeof managementContract;
