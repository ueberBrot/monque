import type { CursorPage, PersistedJob } from "@monque/core";

import type { JobCursorPageDto, JobDto } from "../schemas/index.js";

export function toJobSummaryPageDto(
  page: Omit<CursorPage, "jobs"> & { jobs: Omit<PersistedJob, "data">[] },
): JobCursorPageDto {
  return { ...page, jobs: page.jobs.map(toJobSummaryDto) };
}

export function toJobSummaryDto(job: Omit<PersistedJob, "data">): JobDto {
  const dto: JobDto = {
    id: job._id.toHexString(),
    name: job.name,
    status: job.status,
    priority: job.priority ?? 0,
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

  if (job.leaseExpiresAt !== undefined) {
    dto.leaseExpiresAt = job.leaseExpiresAt.toISOString();
  }

  if (job.repeatInterval != null) {
    dto.repeatInterval = job.repeatInterval;
  }

  if (job.timezone != null) {
    dto.timezone = job.timezone;
  }

  if (job.uniqueKey != null) {
    dto.uniqueKey = job.uniqueKey;
  }

  return dto;
}

function toIsoStringOrNull(value: Date | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toISOString();
}
