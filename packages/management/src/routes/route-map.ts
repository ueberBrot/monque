import { Type } from '@sinclair/typebox';

import { HttpMethod, HttpStatus } from '../http/index.js';
import {
	CapabilitiesSchema,
	ErrorSchema,
	JobCursorPageSchema,
	JobSchema,
	QueueStatsSchema,
	QueueViewSummaryListSchema,
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
} as const;

export type ManagementRoutePathType =
	(typeof ManagementRoutePath)[keyof typeof ManagementRoutePath];

export const MANAGEMENT_ROUTE_MAP = [
	{
		method: HttpMethod.GET,
		path: ManagementRoutePath.HEALTH,
		operationId: 'getSchedulerHealth',
		responseSchema: SchedulerHealthSchema,
		errorSchema: ErrorSchema,
	},
	{
		method: HttpMethod.GET,
		path: ManagementRoutePath.CAPABILITIES,
		operationId: 'getCapabilities',
		responseSchema: CapabilitiesSchema,
		errorSchema: ErrorSchema,
	},
	{
		method: HttpMethod.GET,
		path: ManagementRoutePath.QUEUE_VIEWS,
		operationId: 'listQueueViews',
		responseSchema: QueueViewSummaryListSchema,
		errorSchema: ErrorSchema,
		errorStatuses: [HttpStatus.FORBIDDEN, HttpStatus.INTERNAL_SERVER_ERROR],
	},
	{
		method: HttpMethod.GET,
		path: ManagementRoutePath.JOBS,
		operationId: 'listJobs',
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
				schema: Type.Number({ default: 50, maximum: 100, minimum: 1 }),
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
] as const satisfies readonly ManagementRoute[];
