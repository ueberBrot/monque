import { z } from 'zod';

export const JobStatusDtoSchema = z.enum([
	'pending',
	'processing',
	'completed',
	'failed',
	'cancelled',
]);

export type JobStatusDto = z.infer<typeof JobStatusDtoSchema>;

export const JobDtoSchema = z
	.object({
		id: z.string(),
		name: z.string(),
		status: JobStatusDtoSchema,
		payload: z.custom<unknown>((value) => value !== undefined),
		nextRunAt: z.iso.datetime(),
		lockedAt: z.iso.datetime().nullable(),
		claimedBy: z.string().nullable(),
		lastHeartbeat: z.iso.datetime().nullable(),
		heartbeatInterval: z.number().optional(),
		failCount: z.number(),
		failureReason: z.string().nullable(),
		repeatInterval: z.string().optional(),
		uniqueKey: z.string().optional(),
		createdAt: z.iso.datetime(),
		updatedAt: z.iso.datetime(),
	})
	.strict();

export type JobDto = z.infer<typeof JobDtoSchema>;

export const JobCursorPageDtoSchema = z
	.object({
		jobs: z.array(JobDtoSchema),
		cursor: z.string().nullable(),
		hasNextPage: z.boolean(),
		hasPreviousPage: z.boolean(),
	})
	.strict();

export type JobCursorPageDto = z.infer<typeof JobCursorPageDtoSchema>;

export const JobListQueryDtoSchema = z
	.object({
		cursor: z.string().optional(),
		limit: z.string().optional(),
		name: z.string().optional(),
		status: z.union([JobStatusDtoSchema, z.array(JobStatusDtoSchema).min(1)]).optional(),
	})
	.strict();

export type JobListQueryDto = z.infer<typeof JobListQueryDtoSchema>;

export const JobDetailParamsDtoSchema = z
	.object({
		id: z.string(),
	})
	.strict();

export type JobDetailParamsDto = z.infer<typeof JobDetailParamsDtoSchema>;
