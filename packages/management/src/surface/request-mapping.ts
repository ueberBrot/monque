import { JobCursorSortDirection, JobCursorSortField } from "@monque/core";
import type { CursorOptions, JobCursorFilter, JobSelector } from "@monque/core";
import { ObjectId } from "mongodb";

import type { JobListQueryDto, JobSelectorDto } from "../schemas/index.js";

const JOB_LIST_DATE_FILTER_KEYS = [
  "createdAtFrom",
  "createdAtTo",
  "updatedAtFrom",
  "updatedAtTo",
  "nextRunAtFrom",
  "nextRunAtTo",
] as const;

export const parseObjectId = function parseObjectId(
  value: string | undefined,
): { value: ObjectId } | { error: string } {
  if (value === undefined || value === "" || !ObjectId.isValid(value)) {
    return { error: "Invalid job id" };
  }

  return { value: new ObjectId(value) };
};

export const toJobCursorOptions = function toJobCursorOptions(
  query: JobListQueryDto,
): CursorOptions | { error: string } {
  const limitInput = query.limit;
  let limit = 50;
  if (limitInput !== undefined) {
    limit = Number(limitInput);
    if (!Number.isInteger(limit) || limit < 1) {
      return { error: "Invalid limit" };
    }
    limit = Math.min(limit, 100);
  }

  const filter: JobCursorFilter = {};
  const status =
    Array.isArray(query.status) && query.status.length === 1 ? query.status[0] : query.status;

  if (query.name !== undefined) {
    filter.name = query.name;
  }

  if (status !== undefined) {
    filter.status = status;
  }

  for (const key of JOB_LIST_DATE_FILTER_KEYS) {
    if (query[key] !== undefined) {
      filter[key] = new Date(query[key]);
    }
  }

  const options: CursorOptions = {
    limit,
    sort: {
      by: query.sortBy ?? JobCursorSortField.CREATED_AT,
      direction: query.sortDirection ?? JobCursorSortDirection.DESC,
    },
  };

  if (query.cursor !== undefined) {
    options.cursor = query.cursor;
  }

  if (Object.keys(filter).length > 0) {
    options.filter = filter;
  }

  return options;
};

export const toJobSelector = function toJobSelector(input: JobSelectorDto): JobSelector {
  const selector: JobSelector = {};

  if (input.name !== undefined) {
    selector.name = input.name;
  }

  if (input.status !== undefined) {
    selector.status = input.status;
  }

  if (input.olderThan !== undefined) {
    selector.olderThan = new Date(input.olderThan);
  }

  if (input.newerThan !== undefined) {
    selector.newerThan = new Date(input.newerThan);
  }

  return selector;
};
