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

export async function toJobDto<TContext>(
	options: ManagementOptions<TContext>,
	job: PersistedJob,
	context: TContext,
): Promise<JobDto> {
	const payload = await serializeJobPayload(options, job, context);
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
