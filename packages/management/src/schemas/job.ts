import { z } from 'zod';

/** Job lifecycle status values returned by the management API. */
export const JobStatusDtoSchema = z.enum([
	'pending',
	'processing',
	'completed',
	'failed',
	'cancelled',
]);

/** Job lifecycle status returned by the management API. */
export type JobStatusDto = z.infer<typeof JobStatusDtoSchema>;

/**
 * Public job representation returned by management read and mutation endpoints.
 *
 * Dates are serialized as ISO 8601 strings and nullable scheduler fields are normalized
 * to `null` when absent.
 */
export const JobDtoSchema = z
	.object({
		id: z.string(),
		name: z.string(),
		status: JobStatusDtoSchema,
		payload: z.unknown().nonoptional(),
		nextRunAt: z.iso.datetime(),
		lockedAt: z.iso.datetime().nullable(),
		claimedBy: z.string().nullable(),
		lastHeartbeat: z.iso.datetime().nullable(),
		heartbeatInterval: z.number().int().nonnegative().optional(),
		failCount: z.number().int().nonnegative(),
		failureReason: z.string().nullable(),
		repeatInterval: z.string().optional(),
		uniqueKey: z.string().optional(),
		createdAt: z.iso.datetime(),
		updatedAt: z.iso.datetime(),
	})
	.strict();

/** Public job representation returned by management read and mutation endpoints. */
export type JobDto = z.infer<typeof JobDtoSchema>;

/** Cursor-paginated job list response. */
export const JobCursorPageDtoSchema = z
	.object({
		jobs: z.array(JobDtoSchema),
		cursor: z.string().nullable(),
		hasNextPage: z.boolean(),
		hasPreviousPage: z.boolean(),
	})
	.strict();

/** Cursor-paginated job list response. */
export type JobCursorPageDto = z.infer<typeof JobCursorPageDtoSchema>;

/** Query parameters accepted by `GET /api/v1/jobs`. */
export const JobListQueryDtoSchema = z
	.object({
		cursor: z.string().optional(),
		limit: z.string().optional(),
		name: z.string().optional(),
		status: z.union([JobStatusDtoSchema, z.array(JobStatusDtoSchema).min(1)]).optional(),
	})
	.strict();

/** Query parameters accepted by `GET /api/v1/jobs`. */
export type JobListQueryDto = z.infer<typeof JobListQueryDtoSchema>;

/** Path parameters for routes targeting a single job. */
export const JobDetailParamsDtoSchema = z
	.object({
		id: z.string(),
	})
	.strict();

/** Path parameters for routes targeting a single job. */
export type JobDetailParamsDto = z.infer<typeof JobDetailParamsDtoSchema>;

/** Detailed oRPC input shape for single-job routes. */
export const JobDetailInputDtoSchema = z
	.object({
		params: JobDetailParamsDtoSchema,
		query: z.object({}).strict().optional(),
		headers: z.looseObject({}).optional(),
		body: z.unknown().optional(),
	})
	.strict();

/** Detailed oRPC input shape for single-job routes. */
export type JobDetailInputDto = z.infer<typeof JobDetailInputDtoSchema>;
