import type { CursorPage, PersistedJob } from '@monque/core';
import { type Static, Type } from '@sinclair/typebox';

import type { JobCursorPageDto, JobDto, ManagementOptions } from '../surface/index.js';

const JobStatusSchema = Type.Union([
	Type.Literal('pending'),
	Type.Literal('processing'),
	Type.Literal('completed'),
	Type.Literal('failed'),
	Type.Literal('cancelled'),
]);

/**
 * TypeBox schema for selector-based bulk job actions.
 *
 * Date values are represented as ISO 8601 strings in the HTTP API.
 */
export const JobSelectorSchema = Type.Object(
	{
		name: Type.Optional(Type.String()),
		status: Type.Optional(
			Type.Union([JobStatusSchema, Type.Array(JobStatusSchema, { minItems: 1 })]),
		),
		olderThan: Type.Optional(Type.String({ format: 'date-time' })),
		newerThan: Type.Optional(Type.String({ format: 'date-time' })),
	},
	{ $id: 'JobSelector', additionalProperties: false },
);

/**
 * TypeBox schema for a Management job response.
 */
export const JobSchema = Type.Object(
	{
		id: Type.String(),
		name: Type.String(),
		status: JobStatusSchema,
		payload: Type.Unknown(),
		nextRunAt: Type.String({ format: 'date-time' }),
		lockedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
		claimedBy: Type.Union([Type.String(), Type.Null()]),
		lastHeartbeat: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
		heartbeatInterval: Type.Optional(Type.Number()),
		failCount: Type.Number(),
		failureReason: Type.Union([Type.String(), Type.Null()]),
		repeatInterval: Type.Optional(Type.String()),
		uniqueKey: Type.Optional(Type.String()),
		createdAt: Type.String({ format: 'date-time' }),
		updatedAt: Type.String({ format: 'date-time' }),
	},
	{ $id: 'Job', additionalProperties: false },
);

/**
 * TypeBox schema for a cursor-paginated job list response.
 */
export const JobCursorPageSchema = Type.Object(
	{
		jobs: Type.Array(Type.Unsafe<Static<typeof JobSchema>>(Type.Ref('#/components/schemas/Job'))),
		cursor: Type.Union([Type.String(), Type.Null()]),
		hasNextPage: Type.Boolean(),
		hasPreviousPage: Type.Boolean(),
	},
	{ $id: 'JobCursorPage', additionalProperties: false },
);

/**
 * TypeBox schema for the single-job reschedule request body.
 */
export const RescheduleJobRequestSchema = Type.Object(
	{
		nextRunAt: Type.String({ format: 'date-time' }),
	},
	{ $id: 'RescheduleJobRequest', additionalProperties: false },
);

/**
 * Convert a Monque cursor page to the Management HTTP DTO.
 */
export async function toJobCursorPageDto<TContext>(
	options: ManagementOptions<TContext>,
	page: CursorPage,
	context: TContext,
): Promise<JobCursorPageDto> {
	return {
		jobs: await Promise.all(
			page.jobs.map((job) => toJobDto(options, job as PersistedJob, context)),
		),
		cursor: page.cursor,
		hasNextPage: page.hasNextPage,
		hasPreviousPage: page.hasPreviousPage,
	};
}

/**
 * Convert a persisted Monque job to the Management HTTP DTO.
 *
 * Payload serialization hooks from `ManagementOptions` are applied before the
 * DTO is returned.
 */
export async function toJobDto<TContext>(
	options: ManagementOptions<TContext>,
	job: PersistedJob,
	context: TContext,
): Promise<JobDto> {
	const serializePayload =
		options.serializePayloadByJobName?.[job.name] ?? options.serializePayload;
	const payload = serializePayload
		? await serializePayload({ job, payload: job.data, context })
		: job.data;
	const dto: JobDto = {
		id: job._id.toHexString(),
		name: job.name,
		status: job.status,
		payload,
		nextRunAt: job.nextRunAt.toISOString(),
		lockedAt: job.lockedAt ? job.lockedAt.toISOString() : null,
		claimedBy: job.claimedBy ?? null,
		lastHeartbeat: job.lastHeartbeat ? job.lastHeartbeat.toISOString() : null,
		failCount: job.failCount,
		failureReason: job.failReason ?? null,
		createdAt: job.createdAt.toISOString(),
		updatedAt: job.updatedAt.toISOString(),
	};

	if (job.heartbeatInterval !== undefined) {
		dto.heartbeatInterval = job.heartbeatInterval;
	}

	if (job.repeatInterval !== undefined) {
		dto.repeatInterval = job.repeatInterval;
	}

	if (job.uniqueKey !== undefined) {
		dto.uniqueKey = job.uniqueKey;
	}

	return dto;
}
