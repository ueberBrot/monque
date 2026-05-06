import { Type } from '@sinclair/typebox';

import { HttpMethod, HttpStatus } from '../http/index.js';
import {
	BulkActionResultSchema,
	CapabilitiesSchema,
	DeleteJobSchema,
	ErrorSchema,
	JobCursorPageSchema,
	JobSchema,
	JobSelectorSchema,
	QueueStatsSchema,
	QueueViewSummaryListSchema,
	RescheduleJobRequestSchema,
	SchedulerHealthSchema,
} from '../schemas/index.js';
import type { ManagementRoute } from '../surface/index.js';

export const ManagementRoutePath = {
	HEALTH: '/api/v1/health',
	CAPABILITIES: '/api/v1/capabilities',
	QUEUE_VIEWS: '/api/v1/queue-views',
	JOBS: '/api/v1/jobs',
	JOB_STATS: '/api/v1/jobs/stats',
	JOB_DETAIL: '/api/v1/jobs/{id}',
	JOB_CANCEL: '/api/v1/jobs/{id}/actions/cancel',
	JOB_RETRY: '/api/v1/jobs/{id}/actions/retry',
	JOB_RESCHEDULE: '/api/v1/jobs/{id}/actions/reschedule',
	JOBS_BULK_CANCEL: '/api/v1/jobs/actions/cancel',
	JOBS_BULK_RETRY: '/api/v1/jobs/actions/retry',
	JOBS_BULK_DELETE: '/api/v1/jobs/actions/delete',
} as const;

export type ManagementRoutePathType =
	(typeof ManagementRoutePath)[keyof typeof ManagementRoutePath];

export const MANAGEMENT_ROUTE_MAP = [
	{
		method: HttpMethod.GET,
		path: ManagementRoutePath.HEALTH,
		operationId: 'getSchedulerHealth',
		operation: { kind: 'read' },
		responseSchema: SchedulerHealthSchema,
		errorSchema: ErrorSchema,
	},
	{
		method: HttpMethod.GET,
		path: ManagementRoutePath.CAPABILITIES,
		operationId: 'getCapabilities',
		operation: { kind: 'read' },
		responseSchema: CapabilitiesSchema,
		errorSchema: ErrorSchema,
	},
	{
		method: HttpMethod.GET,
		path: ManagementRoutePath.QUEUE_VIEWS,
		operationId: 'listQueueViews',
		operation: { kind: 'read' },
		responseSchema: QueueViewSummaryListSchema,
		errorSchema: ErrorSchema,
		errorStatuses: [HttpStatus.FORBIDDEN, HttpStatus.INTERNAL_SERVER_ERROR],
	},
	{
		method: HttpMethod.GET,
		path: ManagementRoutePath.JOBS,
		operationId: 'listJobs',
		operation: { kind: 'read' },
		responseSchema: JobCursorPageSchema,
		errorSchema: ErrorSchema,
		errorStatuses: [HttpStatus.BAD_REQUEST, HttpStatus.FORBIDDEN, HttpStatus.INTERNAL_SERVER_ERROR],
		parameters: [
			{
				name: 'cursor',
				in: 'query',
				schema: Type.String(),
			},
			{
				name: 'limit',
				in: 'query',
				schema: Type.Integer({ default: 50, maximum: 100, minimum: 1 }),
			},
			{
				name: 'name',
				in: 'query',
				schema: Type.String(),
			},
			{
				name: 'status',
				in: 'query',
				explode: true,
				schema: Type.Array(
					Type.Union([
						Type.Literal('pending'),
						Type.Literal('processing'),
						Type.Literal('completed'),
						Type.Literal('failed'),
						Type.Literal('cancelled'),
					]),
				),
			},
		],
	},
	{
		method: HttpMethod.GET,
		path: ManagementRoutePath.JOB_STATS,
		operationId: 'getJobStats',
		operation: { kind: 'read' },
		responseSchema: QueueStatsSchema,
		errorSchema: ErrorSchema,
		errorStatuses: [HttpStatus.BAD_REQUEST, HttpStatus.FORBIDDEN, HttpStatus.INTERNAL_SERVER_ERROR],
		parameters: [
			{
				name: 'name',
				in: 'query',
				schema: Type.String(),
			},
		],
	},
	{
		method: HttpMethod.GET,
		path: ManagementRoutePath.JOB_DETAIL,
		operationId: 'getJob',
		operation: { kind: 'read' },
		responseSchema: JobSchema,
		errorSchema: ErrorSchema,
		errorStatuses: [
			HttpStatus.BAD_REQUEST,
			HttpStatus.FORBIDDEN,
			HttpStatus.NOT_FOUND,
			HttpStatus.INTERNAL_SERVER_ERROR,
		],
		parameters: [
			{
				name: 'id',
				in: 'path',
				required: true,
				schema: Type.String(),
			},
		],
	},
	{
		method: HttpMethod.POST,
		path: ManagementRoutePath.JOB_CANCEL,
		operationId: 'cancelJob',
		operation: { kind: 'single-job-action', action: 'cancel', method: 'cancelJob' },
		responseSchema: JobSchema,
		errorSchema: ErrorSchema,
		errorStatuses: [
			HttpStatus.BAD_REQUEST,
			HttpStatus.FORBIDDEN,
			HttpStatus.NOT_FOUND,
			HttpStatus.CONFLICT,
			HttpStatus.INTERNAL_SERVER_ERROR,
		],
		parameters: [
			{
				name: 'id',
				in: 'path',
				required: true,
				schema: Type.String(),
			},
		],
	},
	{
		method: HttpMethod.POST,
		path: ManagementRoutePath.JOB_RETRY,
		operationId: 'retryJob',
		operation: { kind: 'single-job-action', action: 'retry', method: 'retryJob' },
		responseSchema: JobSchema,
		errorSchema: ErrorSchema,
		errorStatuses: [
			HttpStatus.BAD_REQUEST,
			HttpStatus.FORBIDDEN,
			HttpStatus.NOT_FOUND,
			HttpStatus.CONFLICT,
			HttpStatus.INTERNAL_SERVER_ERROR,
		],
		parameters: [
			{
				name: 'id',
				in: 'path',
				required: true,
				schema: Type.String(),
			},
		],
	},
	{
		method: HttpMethod.POST,
		path: ManagementRoutePath.JOB_RESCHEDULE,
		operationId: 'rescheduleJob',
		operation: { kind: 'single-job-action', action: 'reschedule', method: 'rescheduleJob' },
		requestSchema: RescheduleJobRequestSchema,
		responseSchema: JobSchema,
		errorSchema: ErrorSchema,
		errorStatuses: [
			HttpStatus.BAD_REQUEST,
			HttpStatus.FORBIDDEN,
			HttpStatus.NOT_FOUND,
			HttpStatus.CONFLICT,
			HttpStatus.INTERNAL_SERVER_ERROR,
		],
		parameters: [
			{
				name: 'id',
				in: 'path',
				required: true,
				schema: Type.String(),
			},
		],
	},
	{
		method: HttpMethod.POST,
		path: ManagementRoutePath.JOBS_BULK_CANCEL,
		operationId: 'cancelJobs',
		operation: { kind: 'bulk-job-action', action: 'cancel', method: 'cancelJobs' },
		requestSchema: JobSelectorSchema,
		responseSchema: BulkActionResultSchema,
		errorSchema: ErrorSchema,
		errorStatuses: [
			HttpStatus.BAD_REQUEST,
			HttpStatus.FORBIDDEN,
			HttpStatus.CONFLICT,
			HttpStatus.INTERNAL_SERVER_ERROR,
		],
	},
	{
		method: HttpMethod.POST,
		path: ManagementRoutePath.JOBS_BULK_RETRY,
		operationId: 'retryJobs',
		operation: { kind: 'bulk-job-action', action: 'retry', method: 'retryJobs' },
		requestSchema: JobSelectorSchema,
		responseSchema: BulkActionResultSchema,
		errorSchema: ErrorSchema,
		errorStatuses: [
			HttpStatus.BAD_REQUEST,
			HttpStatus.FORBIDDEN,
			HttpStatus.CONFLICT,
			HttpStatus.INTERNAL_SERVER_ERROR,
		],
	},
	{
		method: HttpMethod.POST,
		path: ManagementRoutePath.JOBS_BULK_DELETE,
		operationId: 'deleteJobs',
		operation: { kind: 'bulk-job-action', action: 'delete', method: 'deleteJobs' },
		requestSchema: JobSelectorSchema,
		responseSchema: BulkActionResultSchema,
		errorSchema: ErrorSchema,
		errorStatuses: [
			HttpStatus.BAD_REQUEST,
			HttpStatus.FORBIDDEN,
			HttpStatus.CONFLICT,
			HttpStatus.INTERNAL_SERVER_ERROR,
		],
	},
	{
		method: HttpMethod.DELETE,
		path: ManagementRoutePath.JOB_DETAIL,
		operationId: 'deleteJob',
		operation: { kind: 'single-job-action', action: 'delete', method: 'deleteJob' },
		responseSchema: DeleteJobSchema,
		errorSchema: ErrorSchema,
		errorStatuses: [
			HttpStatus.BAD_REQUEST,
			HttpStatus.FORBIDDEN,
			HttpStatus.NOT_FOUND,
			HttpStatus.CONFLICT,
			HttpStatus.INTERNAL_SERVER_ERROR,
		],
		parameters: [
			{
				name: 'id',
				in: 'path',
				required: true,
				schema: Type.String(),
			},
		],
	},
] as const satisfies readonly ManagementRoute[];

export function findManagementRoute(
	method: ManagementRoute['method'],
	path: string,
): ManagementRoute | undefined {
	return MANAGEMENT_ROUTE_MAP.find((route) => route.method === method && route.path === path);
}
