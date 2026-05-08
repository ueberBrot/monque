import type { QueueStats, QueueViewSummary } from '@monque/core';

import type {
	QueueStatsDto,
	QueueViewSummaryDto,
	QueueViewSummaryListDto,
} from '../schemas/index.js';

export function toQueueViewSummaryListDto(
	queueViews: readonly QueueViewSummary[],
): QueueViewSummaryListDto {
	return {
		queueViews: queueViews.map(toQueueViewSummaryDto),
	};
}

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
