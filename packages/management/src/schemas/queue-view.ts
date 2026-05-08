import { z } from 'zod';

export const QueueStatsDtoSchema = z
	.object({
		pending: z.number(),
		processing: z.number(),
		completed: z.number(),
		failed: z.number(),
		cancelled: z.number(),
		total: z.number(),
		avgProcessingDurationMs: z.number().optional(),
	})
	.strict();

export type QueueStatsDto = z.infer<typeof QueueStatsDtoSchema>;

export const JobStatsQueryDtoSchema = z
	.object({
		name: z.string().optional(),
	})
	.strict();

export const QueueViewWorkerDtoSchema = z
	.object({
		concurrency: z.number(),
		activeCount: z.number(),
	})
	.strict();

export type QueueViewWorkerDto = z.infer<typeof QueueViewWorkerDtoSchema>;

export const QueueViewSummaryDtoSchema = z
	.object({
		name: z.string(),
		hasPersistedJobs: z.boolean(),
		hasRegisteredWorker: z.boolean(),
		stats: QueueStatsDtoSchema,
		worker: QueueViewWorkerDtoSchema.nullable(),
	})
	.strict();

export type QueueViewSummaryDto = z.infer<typeof QueueViewSummaryDtoSchema>;

export const QueueViewSummaryListDtoSchema = z
	.object({
		queueViews: z.array(QueueViewSummaryDtoSchema),
	})
	.strict();

export type QueueViewSummaryListDto = z.infer<typeof QueueViewSummaryListDtoSchema>;
