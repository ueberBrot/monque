import { z } from 'zod';

import { JobDetailParamsDtoSchema, JobStatusDtoSchema } from './job.js';

/**
 * Bulk job selector accepted by management mutation endpoints.
 *
 * Date filters are ISO 8601 strings and are converted to `Date` before calling Monque.
 */
export const JobSelectorDtoSchema = z
	.object({
		name: z.string().optional(),
		status: z.union([JobStatusDtoSchema, z.array(JobStatusDtoSchema).min(1)]).optional(),
		olderThan: z.iso.datetime().optional(),
		newerThan: z.iso.datetime().optional(),
	})
	.strict();

/** Bulk job selector accepted by management mutation endpoints. */
export type JobSelectorDto = z.infer<typeof JobSelectorDtoSchema>;

/** Per-job failure entry returned from bulk management actions. */
export const BulkActionErrorDtoSchema = z
	.object({
		jobId: z.string(),
		error: z.string(),
	})
	.strict();

/** Per-job failure entry returned from bulk management actions. */
export type BulkActionErrorDto = z.infer<typeof BulkActionErrorDtoSchema>;

/** Result returned from bulk cancel, retry, and delete actions. */
export const BulkActionResultDtoSchema = z
	.object({
		count: z.number().int().nonnegative(),
		errors: z.array(BulkActionErrorDtoSchema),
	})
	.strict();

/** Result returned from bulk cancel, retry, and delete actions. */
export type BulkActionResultDto = z.infer<typeof BulkActionResultDtoSchema>;

/** Response body returned after a successful single-job delete. */
export const DeleteJobDtoSchema = z
	.object({
		deleted: z.literal(true),
	})
	.strict();

/** Response body returned after a successful single-job delete. */
export type DeleteJobDto = z.infer<typeof DeleteJobDtoSchema>;

/** Request body for rescheduling a job. */
export const RescheduleJobRequestDtoSchema = z
	.object({
		nextRunAt: z.iso.datetime(),
	})
	.strict();

/** Request body for rescheduling a job. */
export type RescheduleJobRequestDto = z.infer<typeof RescheduleJobRequestDtoSchema>;

/** Detailed oRPC input shape for the reschedule route. */
export const RescheduleJobInputDtoSchema = z
	.object({
		params: JobDetailParamsDtoSchema,
		query: z.object({}).strict().optional(),
		headers: z.looseObject({}).optional(),
		body: RescheduleJobRequestDtoSchema,
	})
	.strict();

/** Detailed oRPC input shape for the reschedule route. */
export type RescheduleJobInputDto = z.infer<typeof RescheduleJobInputDtoSchema>;

/** Standard management error response body. */
export const ManagementErrorDtoSchema = z
	.object({
		error: z.string(),
	})
	.strict();

/** Standard management error response body. */
export type ManagementErrorDto = z.infer<typeof ManagementErrorDtoSchema>;
