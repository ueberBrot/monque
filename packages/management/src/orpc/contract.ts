import { oc } from '@orpc/contract';

import {
	BulkActionResultDtoSchema,
	CapabilitiesDtoSchema,
	JobCursorPageDtoSchema,
	JobDetailInputDtoSchema,
	JobDtoSchema,
	JobListQueryDtoSchema,
	JobSelectorDtoSchema,
	JobStatsQueryDtoSchema,
	ManagementErrorDtoSchema,
	QueueStatsDtoSchema,
	QueueViewSummaryListDtoSchema,
	SchedulerHealthDtoSchema,
} from '../schemas/index.js';

const BulkActionErrors = {
	BAD_REQUEST: {
		status: 400,
		data: ManagementErrorDtoSchema,
	},
	FORBIDDEN: {
		status: 403,
		data: ManagementErrorDtoSchema,
	},
	CONFLICT: {
		status: 409,
		data: ManagementErrorDtoSchema,
	},
	INTERNAL_SERVER_ERROR: {
		status: 500,
		data: ManagementErrorDtoSchema,
	},
} as const;

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
			inputStructure: 'detailed',
		})
		.input(JobDetailInputDtoSchema)
		.output(JobDtoSchema),
	cancelJobs: oc
		.route({
			method: 'POST',
			path: '/api/v1/jobs/actions/cancel',
			operationId: 'cancelJobs',
			successStatus: 200,
			successDescription: 'Successful response',
		})
		.input(JobSelectorDtoSchema)
		.errors(BulkActionErrors)
		.output(BulkActionResultDtoSchema),
	retryJobs: oc
		.route({
			method: 'POST',
			path: '/api/v1/jobs/actions/retry',
			operationId: 'retryJobs',
			successStatus: 200,
			successDescription: 'Successful response',
		})
		.input(JobSelectorDtoSchema)
		.errors(BulkActionErrors)
		.output(BulkActionResultDtoSchema),
	deleteJobs: oc
		.route({
			method: 'POST',
			path: '/api/v1/jobs/actions/delete',
			operationId: 'deleteJobs',
			successStatus: 200,
			successDescription: 'Successful response',
		})
		.input(JobSelectorDtoSchema)
		.errors(BulkActionErrors)
		.output(BulkActionResultDtoSchema),
};

export type ManagementContract = typeof managementContract;
