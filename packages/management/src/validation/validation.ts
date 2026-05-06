import {
	type CursorOptions,
	isValidJobStatus,
	type JobSelector,
	type JobStatusType,
} from '@monque/core';
import { ObjectId } from 'mongodb';

import { JobSelectorSchema, RescheduleJobRequestSchema } from '../dtos/index.js';
import type { ManagementQueryValue } from '../surface/index.js';

const ISO_DATE_TIME_PATTERN =
	/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;

const JOB_LIST_QUERY_FIELDS = ['cursor', 'limit', 'name', 'status'] as const;
const JOB_SELECTOR_FIELDS = Object.keys(JobSelectorSchema.properties);
const RESCHEDULE_REQUEST_FIELDS = Object.keys(RescheduleJobRequestSchema.properties);

export function parseObjectId(value: string | undefined): { value: ObjectId } | { error: string } {
	if (!value || !ObjectId.isValid(value)) {
		return { error: 'Invalid job id' };
	}

	return { value: new ObjectId(value) };
}

export function parseRescheduleBody(body: unknown): { nextRunAt: Date } | { error: string } {
	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		return { error: 'Invalid reschedule request' };
	}

	const nextRunAt = (body as Record<string, unknown>)['nextRunAt'];

	for (const key of Object.keys(body)) {
		if (!RESCHEDULE_REQUEST_FIELDS.includes(key)) {
			return { error: 'Invalid reschedule request' };
		}
	}

	const parsedNextRunAt = parseIsoDateTime(nextRunAt, 'nextRunAt');

	if ('error' in parsedNextRunAt) {
		return parsedNextRunAt;
	}

	return { nextRunAt: parsedNextRunAt.value };
}

export function parseJobSelector(body: unknown): JobSelector | { error: string } {
	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		return { error: 'Invalid job selector' };
	}

	const input = body as Record<string, unknown>;
	const selector: JobSelector = {};
	const name = input['name'];
	const status = input['status'];
	const olderThan = input['olderThan'];
	const newerThan = input['newerThan'];

	for (const key of Object.keys(input)) {
		if (!JOB_SELECTOR_FIELDS.some((field) => field === key)) {
			return { error: 'Invalid job selector' };
		}
	}

	if (name !== undefined) {
		if (typeof name !== 'string') {
			return { error: 'Invalid selector name' };
		}

		selector.name = name;
	}

	const statuses = parseStatuses(status, { preserveArray: true });

	if ('error' in statuses) {
		return statuses;
	}

	if (statuses.status !== undefined) {
		selector.status = statuses.status;
	}

	const olderThanDate = parseOptionalIsoDateTime(olderThan, 'olderThan');

	if ('error' in olderThanDate) {
		return olderThanDate;
	}

	if (olderThanDate.value !== undefined) {
		selector.olderThan = olderThanDate.value;
	}

	const newerThanDate = parseOptionalIsoDateTime(newerThan, 'newerThan');

	if ('error' in newerThanDate) {
		return newerThanDate;
	}

	if (newerThanDate.value !== undefined) {
		selector.newerThan = newerThanDate.value;
	}

	return selector;
}

export function parseJobListQuery(
	query: Readonly<Record<string, ManagementQueryValue>> | undefined,
): CursorOptions | { error: string } {
	if (query) {
		for (const key of Object.keys(query)) {
			if (!JOB_LIST_QUERY_FIELDS.some((field) => field === key)) {
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

export function getSingleQueryValue(
	value: ManagementQueryValue,
): { value: string | undefined } | { error: string } {
	if (value === undefined || typeof value === 'string') {
		return { value };
	}

	return { error: 'Expected single query parameter' };
}

function parseLimit(value: ManagementQueryValue): { limit: number } | { error: string } {
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
	value: ManagementQueryValue | unknown,
	options: { preserveArray?: boolean } = {},
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

	if (!Array.isArray(value) || value.length === 0) {
		return { error: 'Invalid status' };
	}

	const statuses: JobStatusType[] = [];

	for (const status of value) {
		if (typeof status !== 'string' || !isValidJobStatus(status)) {
			return { error: 'Invalid status' };
		}

		statuses.push(status);
	}

	return {
		status: options.preserveArray === true || statuses.length > 1 ? statuses : statuses[0],
	};
}

function parseOptionalIsoDateTime(
	value: unknown,
	fieldName: 'olderThan' | 'newerThan',
): { value: Date | undefined } | { error: string } {
	if (value === undefined) {
		return { value: undefined };
	}

	return parseIsoDateTime(value, fieldName);
}

function parseIsoDateTime(
	value: unknown,
	fieldName: 'nextRunAt' | 'olderThan' | 'newerThan',
): { value: Date } | { error: string } {
	if (typeof value !== 'string') {
		return { error: `Invalid ${fieldName}` };
	}

	if (!isValidIsoDateTime(value)) {
		return { error: `Invalid ${fieldName}` };
	}

	const date = new Date(value);

	if (Number.isNaN(date.getTime())) {
		return { error: `Invalid ${fieldName}` };
	}

	return { value: date };
}

function isValidIsoDateTime(value: string): boolean {
	const match = ISO_DATE_TIME_PATTERN.exec(value);

	if (!match) {
		return false;
	}

	const [, yearValue, monthValue, dayValue, hourValue, minuteValue, secondValue] = match;
	const year = Number(yearValue);
	const month = Number(monthValue);
	const day = Number(dayValue);
	const hour = Number(hourValue);
	const minute = Number(minuteValue);
	const second = Number(secondValue);

	if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
		return false;
	}

	const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

	return (
		utcDate.getUTCFullYear() === year &&
		utcDate.getUTCMonth() === month - 1 &&
		utcDate.getUTCDate() === day &&
		utcDate.getUTCHours() === hour &&
		utcDate.getUTCMinutes() === minute &&
		utcDate.getUTCSeconds() === second
	);
}
