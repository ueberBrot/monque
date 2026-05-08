import { z } from 'zod';

import { JobDetailParamsDtoSchema, JobStatusDtoSchema } from './job.js';

export const JobSelectorDtoSchema = z
	.object({
		name: z.string().optional(),
		status: z.union([JobStatusDtoSchema, z.array(JobStatusDtoSchema).min(1)]).optional(),
		olderThan: z.iso.datetime().optional(),
		newerThan: z.iso.datetime().optional(),
	})
	.strict();

export type JobSelectorDto = z.infer<typeof JobSelectorDtoSchema>;

export const BulkActionErrorDtoSchema = z
	.object({
		jobId: z.string(),
		error: z.string(),
	})
	.strict();

export type BulkActionErrorDto = z.infer<typeof BulkActionErrorDtoSchema>;

export const BulkActionResultDtoSchema = z
	.object({
		count: z.number(),
		errors: z.array(BulkActionErrorDtoSchema),
	})
	.strict();

export type BulkActionResultDto = z.infer<typeof BulkActionResultDtoSchema>;

export const DeleteJobDtoSchema = z
	.object({
		deleted: z.literal(true),
	})
	.strict();

export type DeleteJobDto = z.infer<typeof DeleteJobDtoSchema>;

export const RescheduleJobRequestDtoSchema = z
	.object({
		nextRunAt: z.iso.datetime(),
	})
	.strict();

export type RescheduleJobRequestDto = z.infer<typeof RescheduleJobRequestDtoSchema>;

export const RescheduleJobInputDtoSchema = z
	.object({
		params: JobDetailParamsDtoSchema,
		query: z.object({}).strict().optional(),
		headers: z.looseObject({}).optional(),
		body: RescheduleJobRequestDtoSchema,
	})
	.strict();

export type RescheduleJobInputDto = z.infer<typeof RescheduleJobInputDtoSchema>;

export const ManagementErrorDtoSchema = z
	.object({
		error: z.string(),
	})
	.strict();

export type ManagementErrorDto = z.infer<typeof ManagementErrorDtoSchema>;
