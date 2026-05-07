import { oc } from '@orpc/contract';

import { SchedulerHealthDtoSchema } from '../schemas/index.js';

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
};

export type ManagementContract = typeof managementContract;
