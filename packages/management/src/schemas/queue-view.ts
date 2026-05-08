import { z } from 'zod';

/** Aggregated job counts and timing statistics for a queue or the whole scheduler. */
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

/** Aggregated job counts and timing statistics for a queue or the whole scheduler. */
export type QueueStatsDto = z.infer<typeof QueueStatsDtoSchema>;

/** Query parameters accepted by `GET /api/v1/jobs/stats`. */
export const JobStatsQueryDtoSchema = z
	.object({
		name: z.string().optional(),
	})
	.strict();

/** Local worker state for a queue view, when this scheduler has a worker registered. */
export const QueueViewWorkerDtoSchema = z
	.object({
		concurrency: z.number(),
		activeCount: z.number(),
	})
	.strict();

/** Local worker state for a queue view, when this scheduler has a worker registered. */
export type QueueViewWorkerDto = z.infer<typeof QueueViewWorkerDtoSchema>;

/** Summary of persisted jobs, aggregate stats, and local worker state for one queue name. */
export const QueueViewSummaryDtoSchema = z
	.object({
		name: z.string(),
		hasPersistedJobs: z.boolean(),
		hasRegisteredWorker: z.boolean(),
		stats: QueueStatsDtoSchema,
		worker: QueueViewWorkerDtoSchema.nullable(),
	})
	.strict();

/** Summary of persisted jobs, aggregate stats, and local worker state for one queue name. */
export type QueueViewSummaryDto = z.infer<typeof QueueViewSummaryDtoSchema>;

/** List response returned by the queue-views endpoint. */
export const QueueViewSummaryListDtoSchema = z
	.object({
		queueViews: z.array(QueueViewSummaryDtoSchema),
	})
	.strict();

/** List response returned by the queue-views endpoint. */
export type QueueViewSummaryListDto = z.infer<typeof QueueViewSummaryListDtoSchema>;
