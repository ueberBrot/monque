import type { CursorPage, PersistedJob } from '@monque/core';

import type { JobCursorPageDto, JobDto } from '../schemas/index.js';
import { serializeJobPayload } from '../surface/payload-serialization.js';
import type { ManagementOptions } from '../surface/types.js';

export async function toJobCursorPageDto<TContext>(
	options: ManagementOptions<TContext>,
	page: CursorPage,
	context: TContext,
): Promise<JobCursorPageDto> {
	return {
		jobs: await Promise.all(page.jobs.map((job) => toJobDto(options, job, context))),
		cursor: page.cursor,
		hasNextPage: page.hasNextPage,
		hasPreviousPage: page.hasPreviousPage,
	};
}

export function toJobSummaryPageDto(
	page: Omit<CursorPage, 'jobs'> & { jobs: Omit<PersistedJob, 'data'>[] },
): JobCursorPageDto {
	return { ...page, jobs: page.jobs.map(toJobSummaryDto) };
}

export async function toJobDto<TContext>(
	options: ManagementOptions<TContext>,
	job: PersistedJob,
	context: TContext,
): Promise<JobDto> {
	return { ...toJobSummaryDto(job), payload: await serializeJobPayload(options, job, context) };
}

export function toJobSummaryDto(job: Omit<PersistedJob, 'data'>): JobDto {
	const dto: JobDto = {
		id: job._id.toHexString(),
		name: job.name,
		status: job.status,
		payload: null,
		nextRunAt: job.nextRunAt.toISOString(),
		lockedAt: toIsoStringOrNull(job.lockedAt),
		claimedBy: job.claimedBy ?? null,
		lastHeartbeat: toIsoStringOrNull(job.lastHeartbeat),
		failCount: job.failCount,
		failureReason: job.failReason ?? null,
		createdAt: job.createdAt.toISOString(),
		updatedAt: job.updatedAt.toISOString(),
	};

	if (job.heartbeatInterval != null) {
		dto.heartbeatInterval = job.heartbeatInterval;
	}

	if (job.repeatInterval != null) {
		dto.repeatInterval = job.repeatInterval;
	}

	if (job.uniqueKey != null) {
		dto.uniqueKey = job.uniqueKey;
	}

	return dto;
}

function toIsoStringOrNull(value: Date | null | undefined): string | null {
	return value === null || value === undefined ? null : value.toISOString();
}
