import type { QueueStats, QueueViewSummary } from '@monque/core';
import { type Static, Type } from '@sinclair/typebox';

import type {
	QueueStatsDto,
	QueueViewSummaryDto,
	QueueViewSummaryListDto,
} from '../surface/index.js';

/**
 * TypeBox schema for aggregate queue statistics.
 */
export const QueueStatsSchema = Type.Object(
	{
		pending: Type.Number(),
		processing: Type.Number(),
		completed: Type.Number(),
		failed: Type.Number(),
		cancelled: Type.Number(),
		total: Type.Number(),
		avgProcessingDurationMs: Type.Optional(Type.Number()),
	},
	{ $id: 'QueueStats', additionalProperties: false },
);

/**
 * TypeBox schema for the queue-view summary list response.
 */
export const QueueViewSummaryListSchema = Type.Object(
	{
		queueViews: Type.Array(
			Type.Object(
				{
					name: Type.String(),
					hasPersistedJobs: Type.Boolean(),
					hasRegisteredWorker: Type.Boolean(),
					stats: Type.Unsafe<Static<typeof QueueStatsSchema>>(
						Type.Ref('#/components/schemas/QueueStats'),
					),
					worker: Type.Union([
						Type.Object(
							{
								concurrency: Type.Number(),
								activeCount: Type.Number(),
							},
							{ additionalProperties: false },
						),
						Type.Null(),
					]),
				},
				{ additionalProperties: false },
			),
		),
	},
	{ $id: 'QueueViewSummaryList', additionalProperties: false },
);

/**
 * Convert Monque queue-view summaries to the Management HTTP DTO.
 */
export function toQueueViewSummaryListDto(
	queueViews: readonly QueueViewSummary[],
): QueueViewSummaryListDto {
	return {
		queueViews: queueViews.map(toQueueViewSummaryDto),
	};
}

/**
 * Convert Monque queue statistics to the Management HTTP DTO.
 */
export function toQueueStatsDto(stats: QueueStats): QueueStatsDto {
	const dto: QueueStatsDto = {
		pending: stats.pending,
		processing: stats.processing,
		completed: stats.completed,
		failed: stats.failed,
		cancelled: stats.cancelled,
		total: stats.total,
	};

	if (stats.avgProcessingDurationMs !== undefined) {
		dto.avgProcessingDurationMs = stats.avgProcessingDurationMs;
	}

	return dto;
}

function toQueueViewSummaryDto(queueView: QueueViewSummary): QueueViewSummaryDto {
	return {
		name: queueView.name,
		hasPersistedJobs: queueView.hasPersistedJobs,
		hasRegisteredWorker: queueView.hasRegisteredWorker,
		stats: toQueueStatsDto(queueView.stats),
		worker: queueView.worker
			? {
					concurrency: queueView.worker.concurrency,
					activeCount: queueView.worker.activeCount,
				}
			: null,
	};
}
