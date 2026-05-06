import type {
	BulkOperationResult,
	CursorPage,
	PersistedJob,
	QueueStats,
	QueueViewSummary,
} from '@monque/core';

import type {
	BulkActionResultDto,
	DeleteJobDto,
	JobCursorPageDto,
	JobDto,
	ManagementOptions,
	QueueStatsDto,
	QueueViewSummaryDto,
	QueueViewSummaryListDto,
	SchedulerHealthDto,
} from '../surface/index.js';

export function toSchedulerHealthDto(healthy: boolean): SchedulerHealthDto {
	return {
		status: healthy ? 'ok' : 'unavailable',
		scheduler: {
			healthy,
		},
	};
}

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

export function toDeleteJobDto(): DeleteJobDto {
	return { deleted: true };
}

export function toBulkActionResultDto(result: BulkOperationResult): BulkActionResultDto {
	return {
		count: result.count,
		errors: result.errors.map((error) => ({
			jobId: error.jobId,
			error: error.error,
		})),
	};
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
