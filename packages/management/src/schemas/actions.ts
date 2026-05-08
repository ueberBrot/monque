import { z } from 'zod';

import { JobStatusDtoSchema } from './job.js';

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
