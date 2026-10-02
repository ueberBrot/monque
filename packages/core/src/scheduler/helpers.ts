import type { Document, Filter } from "mongodb";

import { isValidJobStatus, type JobCursorFilter, type JobSelector } from "@/jobs";
import { InvalidJobQueryError } from "@/shared";

type CursorQueryFilter = JobSelector | JobCursorFilter;
type DateRangeField = "createdAt" | "updatedAt" | "nextRunAt";
type DateRangeQuery = {
  $gt?: Date;
  $gte?: Date;
  $lt?: Date;
  $lte?: Date;
};

const MAX_QUERY_LIMIT = 1000;

export function resolveQueryLimit(limit: number | undefined, defaultLimit: number): number {
  const value = limit === undefined ? defaultLimit : limit;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_QUERY_LIMIT) {
    throw new InvalidJobQueryError(`limit must be an integer between 1 and ${MAX_QUERY_LIMIT}`);
  }
  return value;
}

/**
 * Build a MongoDB query filter from a selector or cursor filter.
 *
 * Handles array values for status (using `$in`) and date range filtering.
 *
 * @param filter - The user-provided job selector or cursor filter
 * @returns A standard MongoDB filter object
 */
export function buildSelectorQuery(filter: CursorQueryFilter): Filter<Document> {
  const query: Filter<Document> = {};
  const name = parseJobNameFilter(filter);

  if (name !== undefined) {
    query["name"] = name;
  }

  const status = filter.status;
  if (status !== undefined) {
    if (Array.isArray(status)) {
      const statuses = [...status];
      if (!statuses.every(isValidJobStatus)) {
        throw new InvalidJobQueryError("Job status filter contains an invalid status");
      }
      query["status"] = { $in: statuses };
    } else {
      if (!isValidJobStatus(status)) {
        throw new InvalidJobQueryError("Job status filter must be a valid status or status array");
      }
      query["status"] = status;
    }
  }

  applySelectorCreatedAtRange(query, filter);
  applyCursorDateRanges(query, filter);

  return query;
}

/** Validate an exact Job Name scope before query construction or cache lookup. */
export function parseJobNameFilter(filter: unknown): string | undefined {
  if (!isRecord(filter)) {
    throw new InvalidJobQueryError("Job filter must be an object");
  }
  const name = filter["name"];
  if (name !== undefined && (typeof name !== "string" || name.length === 0)) {
    throw new InvalidJobQueryError("Job name filter must be a non-empty string");
  }
  return name;
}

function applySelectorCreatedAtRange(query: Filter<Document>, filter: CursorQueryFilter): void {
  if (!("olderThan" in filter || "newerThan" in filter)) {
    return;
  }
  validateQueryDate(filter.olderThan, "olderThan");
  validateQueryDate(filter.newerThan, "newerThan");

  const range = getDateRange(query, "createdAt");

  if (filter.olderThan) {
    range["$lt"] = filter.olderThan;
  }

  if (filter.newerThan) {
    range["$gt"] = filter.newerThan;
  }

  query["createdAt"] = range;
}

function applyCursorDateRanges(query: Filter<Document>, filter: CursorQueryFilter): void {
  if ("createdAtFrom" in filter || "createdAtTo" in filter) {
    applyDateRange(query, "createdAt", filter.createdAtFrom, filter.createdAtTo);
  }

  if ("updatedAtFrom" in filter || "updatedAtTo" in filter) {
    applyDateRange(query, "updatedAt", filter.updatedAtFrom, filter.updatedAtTo);
  }

  if ("nextRunAtFrom" in filter || "nextRunAtTo" in filter) {
    applyDateRange(query, "nextRunAt", filter.nextRunAtFrom, filter.nextRunAtTo);
  }
}

function applyDateRange(
  query: Filter<Document>,
  field: DateRangeField,
  from?: Date,
  to?: Date,
): void {
  validateQueryDate(from, `${field}From`);
  validateQueryDate(to, `${field}To`);
  if (!from && !to) {
    return;
  }

  const range = getDateRange(query, field);

  if (from) {
    range["$gte"] = from;
  }

  if (to) {
    range["$lte"] = to;
  }

  query[field] = range;
}

function validateQueryDate(value: unknown, field: string): void {
  if (value !== undefined && (!(value instanceof Date) || !Number.isFinite(value.getTime()))) {
    throw new InvalidJobQueryError(`${field} must be a valid Date`);
  }
}

function getDateRange(query: Filter<Document>, field: DateRangeField): DateRangeQuery {
  const existing = query[field];

  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    return existing as DateRangeQuery;
  }

  return {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
