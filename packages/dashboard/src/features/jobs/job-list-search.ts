import {
  JobListSortByDtoSchema,
  JobListSortDirectionDtoSchema,
  JobStatusDtoSchema,
} from "@monque/management/contract";
import type { JobDto, JobListQueryDto } from "@monque/management/contract";
import { z } from "zod";

import { parseDashboardDate } from "@/lib/dates";
import { isNumber, isString } from "@/lib/type-guards";

import { JOB_STATUS_META } from "./job-status.js";

const JOB_STATUS_ORDER = ["pending", "processing", "completed", "failed", "cancelled"] as const;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
interface JobsRouteSearch {
  readonly createdAtFrom: string | undefined;
  readonly createdAtTo: string | undefined;
  readonly cursor: string | undefined;
  readonly limit: number;
  readonly name: string | undefined;
  readonly nextRunAtFrom: string | undefined;
  readonly nextRunAtTo: string | undefined;
  readonly sortBy: JobListSortByDto;
  readonly sortDirection: JobListSortDirectionDto;
  readonly status: readonly JobStatusDto[];
  readonly updatedAtFrom: string | undefined;
  readonly updatedAtTo: string | undefined;
}
type JobListSortByDto = NonNullable<JobListQueryDto["sortBy"]>;
type JobListSortDirectionDto = NonNullable<JobListQueryDto["sortDirection"]>;
type JobStatusDto = JobDto["status"];
const getOptionalStringSchema = z
  .unknown()
  .transform((value) => (isString(value) && value.length > 0 ? value : undefined));
const getOptionalString = getOptionalStringSchema.parse.bind(getOptionalStringSchema);
const normalizeLimit = (value: number): number => {
  if (!Number.isInteger(value) || value <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(value, MAX_LIMIT);
};
const parseLimitSchema = z.unknown().transform((value) => {
  if (isNumber(value)) {
    return normalizeLimit(value);
  }
  if (isString(value)) {
    const prefix = /^[+-]?\d+/u.exec(value.trimStart());
    return normalizeLimit(prefix === null ? Number.NaN : Number(prefix[0]));
  }
  return DEFAULT_LIMIT;
});
const parseLimit = parseLimitSchema.parse.bind(parseLimitSchema);
const parseStatusFilterSchema = z.unknown().transform((value) => {
  const values: unknown[] = Array.isArray(value) ? value : [value];
  const parsedStatuses = new Set(
    values
      .flatMap((candidate) => (isString(candidate) ? [candidate] : []))
      .filter(
        (candidate): candidate is JobStatusDto => JobStatusDtoSchema.safeParse(candidate).success,
      ),
  );
  return JOB_STATUS_ORDER.filter((status) => parsedStatuses.has(status));
});
const parseStatusFilter = parseStatusFilterSchema.parse.bind(parseStatusFilterSchema);
const getOptionalIsoDateSchema = z
  .unknown()
  .transform((value) =>
    isString(value) && value.length > 0 ? parseDashboardDate(value)?.toISOString() : undefined,
  );
const getOptionalIsoDate = getOptionalIsoDateSchema.parse.bind(getOptionalIsoDateSchema);
const parseSortBySchema = z.unknown().transform((value) => {
  const parsed = JobListSortByDtoSchema.safeParse(value);
  return parsed.success ? parsed.data : "createdAt";
});
const parseSortBy = parseSortBySchema.parse.bind(parseSortBySchema);
const parseSortDirectionSchema = z.unknown().transform((value) => {
  const parsed = JobListSortDirectionDtoSchema.safeParse(value);
  return parsed.success ? parsed.data : "desc";
});
const parseSortDirection = parseSortDirectionSchema.parse.bind(parseSortDirectionSchema);
const parseJobsRouteSearchSchema = z
  .object({
    cursor: z.unknown().optional(),
    limit: z.unknown().optional(),
    name: z.unknown().optional(),
    status: z.unknown().optional(),
    createdAtFrom: z.unknown().optional(),
    createdAtTo: z.unknown().optional(),
    updatedAtFrom: z.unknown().optional(),
    updatedAtTo: z.unknown().optional(),
    nextRunAtFrom: z.unknown().optional(),
    nextRunAtTo: z.unknown().optional(),
    sortBy: z.unknown().optional(),
    sortDirection: z.unknown().optional(),
  })
  .transform((search): JobsRouteSearch => ({
    cursor: getOptionalString(getOptionalString(search.cursor)?.trim()),
    limit: parseLimit(search.limit),
    name: getOptionalString(search.name),
    status: parseStatusFilter(search.status),
    createdAtFrom: getOptionalIsoDate(search.createdAtFrom),
    createdAtTo: getOptionalIsoDate(search.createdAtTo),
    updatedAtFrom: getOptionalIsoDate(search.updatedAtFrom),
    updatedAtTo: getOptionalIsoDate(search.updatedAtTo),
    nextRunAtFrom: getOptionalIsoDate(search.nextRunAtFrom),
    nextRunAtTo: getOptionalIsoDate(search.nextRunAtTo),
    sortBy: parseSortBy(search.sortBy),
    sortDirection: parseSortDirection(search.sortDirection),
  }));
const parseJobsRouteSearch = parseJobsRouteSearchSchema.parse.bind(parseJobsRouteSearchSchema);
const toJobListStatusQuery = (status: readonly JobStatusDto[]): JobListQueryDto["status"] => {
  if (status.length === 0) {
    return undefined;
  }
  if (status.length === 1) {
    return status[0];
  }
  return [...status];
};
const toJobListQueryInput = (search: JobsRouteSearch): JobListQueryDto => ({
  ...search,
  limit: String(search.limit),
  status: toJobListStatusQuery(search.status),
});
const getJobsSearchIdentity = ({ cursor: _cursor, ...filters }: JobsRouteSearch): string =>
  JSON.stringify(filters);
const getNextSort = (
  currentSortBy: JobListSortByDto,
  currentSortDirection: JobListSortDirectionDto,
  nextSortBy: JobListSortByDto,
): Pick<JobsRouteSearch, "sortBy" | "sortDirection"> => {
  if (currentSortBy !== nextSortBy) {
    return {
      sortBy: nextSortBy,
      sortDirection: nextSortBy === "identifier" ? "asc" : "desc",
    };
  }
  return {
    sortBy: nextSortBy,
    sortDirection: currentSortDirection === "asc" ? "desc" : "asc",
  };
};
const getStatusLabel = (status: JobStatusDto): string => JOB_STATUS_META[status].label;
export {
  getJobsSearchIdentity,
  getNextSort,
  getStatusLabel,
  JOB_STATUS_ORDER,
  type JobListSortByDto,
  type JobListSortDirectionDto,
  type JobStatusDto,
  type JobsRouteSearch,
  parseJobsRouteSearch,
  toJobListQueryInput,
};
