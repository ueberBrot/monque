import { oc } from '@orpc/contract';

import {
	CapabilitiesDtoSchema,
	JobCursorPageDtoSchema,
	JobDetailParamsDtoSchema,
	JobDtoSchema,
	JobListQueryDtoSchema,
	JobStatsQueryDtoSchema,
	QueueStatsDtoSchema,
	QueueViewSummaryListDtoSchema,
	SchedulerHealthDtoSchema,
} from '../schemas/index.js';

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
	queueViews: oc
		.route({
			method: 'GET',
			path: '/api/v1/queue-views',
			operationId: 'listQueueViews',
			successStatus: 200,
			successDescription: 'Successful response',
		})
		.output(QueueViewSummaryListDtoSchema),
	jobs: oc
		.route({
			method: 'GET',
			path: '/api/v1/jobs',
			operationId: 'listJobs',
			successStatus: 200,
			successDescription: 'Successful response',
		})
		.input(JobListQueryDtoSchema)
		.output(JobCursorPageDtoSchema),
	jobStats: oc
		.route({
			method: 'GET',
			path: '/api/v1/jobs/stats',
			operationId: 'getJobStats',
			successStatus: 200,
			successDescription: 'Successful response',
		})
		.input(JobStatsQueryDtoSchema)
		.output(QueueStatsDtoSchema),
	job: oc
		.route({
			method: 'GET',
			path: '/api/v1/jobs/{id}',
			operationId: 'getJob',
			successStatus: 200,
			successDescription: 'Successful response',
		})
		.input(JobDetailParamsDtoSchema)
		.output(JobDtoSchema),
};

export type ManagementContract = typeof managementContract;
