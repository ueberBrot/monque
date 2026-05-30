import {
	type CursorOptions,
	isValidJobStatus,
	type JobCursorFilter,
	JobCursorSortDirection,
	JobCursorSortField,
	type JobSelector,
	type JobStatusType,
} from '@monque/core';
import { ObjectId } from 'mongodb';

import type { JobListQueryDto, JobSelectorDto } from '../schemas/index.js';

const JOB_LIST_DATE_FILTER_KEYS = [
	'createdAtFrom',
	'createdAtTo',
	'updatedAtFrom',
	'updatedAtTo',
	'nextRunAtFrom',
	'nextRunAtTo',
] as const;

type JobListDateFilterKey = (typeof JOB_LIST_DATE_FILTER_KEYS)[number];

export function parseObjectId(value: string | undefined): { value: ObjectId } | { error: string } {
	if (!value || !ObjectId.isValid(value)) {
		return { error: 'Invalid job id' };
	}

	return { value: new ObjectId(value) };
}

export function toJobCursorOptions(query: JobListQueryDto): CursorOptions | { error: string } {
	const limitResult = parseLimit(query.limit);

	if ('error' in limitResult) {
		return limitResult;
	}

	const statusesResult = parseStatuses(query.status);

	if ('error' in statusesResult) {
		return statusesResult;
	}

	const filter: JobCursorFilter = {};

	if (query.name !== undefined) {
		filter.name = query.name;
	}

	if (statusesResult.status !== undefined) {
		filter.status = statusesResult.status;
	}

	for (const key of JOB_LIST_DATE_FILTER_KEYS) {
		applyDateFilter(filter, key, query[key]);
	}

	const options: CursorOptions = {
		limit: limitResult.limit,
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
}

export function toQueueStatsFilter(input: {
	name?: string | undefined;
}): { name: string } | undefined {
	if (input.name === undefined) {
		return undefined;
	}

	return { name: input.name };
}

export function toJobSelector(input: JobSelectorDto): JobSelector {
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
}

function parseLimit(value: string | undefined): { limit: number } | { error: string } {
	if (value === undefined) {
		return { limit: 50 };
	}

	const limit = Number(value);

	if (!Number.isInteger(limit) || limit < 1) {
		return { error: 'Invalid limit' };
	}

	return {
		limit: Math.min(limit, 100),
	};
}

function parseStatuses(
	value: JobListQueryDto['status'],
): { status: JobStatusType | JobStatusType[] | undefined } | { error: string } {
	if (value === undefined) {
		return { status: undefined };
	}

	const requestedStatuses = Array.isArray(value) ? value : [value];

	if (requestedStatuses.length === 0) {
		return { error: 'Invalid status' };
	}

	const statuses: JobStatusType[] = [];

	for (const status of requestedStatuses) {
		if (!isValidJobStatus(status)) {
			return { error: 'Invalid status' };
		}

		statuses.push(status);
	}

	return {
		status: statuses.length > 1 ? statuses : statuses[0],
	};
}

function applyDateFilter(
	filter: JobCursorFilter,
	key: JobListDateFilterKey,
	value: string | undefined,
): void {
	if (value === undefined) {
		return;
	}

	filter[key] = new Date(value);
}
