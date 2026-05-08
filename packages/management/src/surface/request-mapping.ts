import {
	type CursorOptions,
	isValidJobStatus,
	type JobSelector,
	type JobStatusType,
} from '@monque/core';
import { ObjectId } from 'mongodb';

import type { JobListQueryDto, JobSelectorDto } from '../schemas/index.js';

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

	const filter: CursorOptions['filter'] = {};

	if (query.name !== undefined) {
		filter.name = query.name;
	}

	if (statusesResult.status !== undefined) {
		filter.status = statusesResult.status;
	}

	const options: CursorOptions = {
		limit: limitResult.limit,
	};

	if (query.cursor !== undefined) {
		options.cursor = query.cursor;
	}

	if (Object.keys(filter).length > 0) {
		options.filter = filter;
	}

	return options;
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

	if (typeof value === 'string') {
		if (!isValidJobStatus(value)) {
			return { error: 'Invalid status' };
		}

		return { status: value };
	}

	if (value.length === 0) {
		return { error: 'Invalid status' };
	}

	const statuses: JobStatusType[] = [];

	for (const status of value) {
		if (!isValidJobStatus(status)) {
			return { error: 'Invalid status' };
		}

		statuses.push(status);
	}

	return {
		status: statuses.length > 1 ? statuses : statuses[0],
	};
}
