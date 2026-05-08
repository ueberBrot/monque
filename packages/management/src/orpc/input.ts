import { type CursorOptions, isValidJobStatus, type JobStatusType } from '@monque/core';
import { ObjectId } from 'mongodb';

import type { JobListQueryDto } from '../schemas/index.js';

type QueryValue = string | readonly string[] | undefined;

export function parseObjectId(value: string | undefined): { value: ObjectId } | { error: string } {
	if (!value || !ObjectId.isValid(value)) {
		return { error: 'Invalid job id' };
	}

	return { value: new ObjectId(value) };
}

export function parseJobListQuery(
	query: Readonly<Record<string, QueryValue>> | undefined,
): CursorOptions | { error: string } {
	if (query) {
		for (const key of Object.keys(query)) {
			if (!isJobListQueryField(key)) {
				return { error: 'Invalid job list query' };
			}
		}
	}

	const limitResult = parseLimit(query?.['limit']);

	if ('error' in limitResult) {
		return limitResult;
	}

	const statusesResult = parseStatuses(query?.['status']);

	if ('error' in statusesResult) {
		return statusesResult;
	}

	const filter: CursorOptions['filter'] = {};
	const name = getSingleQueryValue(query?.['name']);

	if ('error' in name) {
		return name;
	}

	if (name.value !== undefined) {
		filter.name = name.value;
	}

	if (statusesResult.status !== undefined) {
		filter.status = statusesResult.status;
	}

	const cursor = getSingleQueryValue(query?.['cursor']);

	if ('error' in cursor) {
		return cursor;
	}

	const options: CursorOptions = {
		limit: limitResult.limit,
	};

	if (cursor.value !== undefined) {
		options.cursor = cursor.value;
	}

	if (Object.keys(filter).length > 0) {
		options.filter = filter;
	}

	return options;
}

export function toManagementQuery(input: JobListQueryDto): Record<string, QueryValue> {
	const query: Record<string, QueryValue> = {};

	if (input.cursor !== undefined) {
		query['cursor'] = input.cursor;
	}

	if (input.limit !== undefined) {
		query['limit'] = input.limit;
	}

	if (input.name !== undefined) {
		query['name'] = input.name;
	}

	if (input.status !== undefined) {
		query['status'] = input.status;
	}

	return query;
}

function getSingleQueryValue(value: QueryValue): { value: string | undefined } | { error: string } {
	if (value === undefined || typeof value === 'string') {
		return { value };
	}

	return { error: 'Expected single query parameter' };
}

function parseLimit(value: QueryValue): { limit: number } | { error: string } {
	const raw = getSingleQueryValue(value);

	if ('error' in raw) {
		return raw;
	}

	if (raw.value === undefined) {
		return { limit: 50 };
	}

	const limit = Number(raw.value);

	if (!Number.isInteger(limit) || limit < 1) {
		return { error: 'Invalid limit' };
	}

	return {
		limit: Math.min(limit, 100),
	};
}

function parseStatuses(
	value: QueryValue,
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

function isJobListQueryField(value: string): value is keyof JobListQueryDto {
	return value === 'cursor' || value === 'limit' || value === 'name' || value === 'status';
}
