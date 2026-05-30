import { type Document, type Filter, ObjectId } from 'mongodb';

import {
	CursorDirection,
	type CursorDirectionType,
	type JobCursorFilter,
	type JobCursorSort,
	JobCursorSortDirection,
	type JobCursorSortDirectionType,
	JobCursorSortField,
	type JobCursorSortFieldType,
	type JobSelector,
} from '@/jobs';
import { InvalidCursorError } from '@/shared';

type CursorQueryFilter = JobSelector | JobCursorFilter;
type DateRangeField = 'createdAt' | 'updatedAt' | 'nextRunAt';
type DateRangeQuery = {
	$gt?: Date;
	$gte?: Date;
	$lt?: Date;
	$lte?: Date;
};

type EncodedCursorPayload = {
	id: string;
	sort: {
		by: JobCursorSortFieldType;
		direction: JobCursorSortDirectionType;
		value: string;
	};
};

export type DecodedCursor = {
	id: ObjectId;
	direction: CursorDirectionType;
	sort?: {
		by: JobCursorSortFieldType;
		direction: JobCursorSortDirectionType;
		value: Date;
	};
};

const DEFAULT_CURSOR_SORT: JobCursorSort = {
	by: JobCursorSortField.IDENTIFIER,
	direction: JobCursorSortDirection.ASC,
};
const LEGACY_CURSOR_PAYLOAD_BYTES = 12;
const STRUCTURED_CURSOR_PAYLOAD_PREFIX = '{'.charCodeAt(0);

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

	if (filter.name) {
		query['name'] = filter.name;
	}

	if (filter.status) {
		if (Array.isArray(filter.status)) {
			query['status'] = { $in: filter.status };
		} else {
			query['status'] = filter.status;
		}
	}

	applySelectorCreatedAtRange(query, filter);
	applyCursorDateRanges(query, filter);

	return query;
}

function applySelectorCreatedAtRange(query: Filter<Document>, filter: CursorQueryFilter): void {
	if (!('olderThan' in filter || 'newerThan' in filter)) {
		return;
	}

	const range = getDateRange(query, 'createdAt');

	if (filter.olderThan) {
		range['$lt'] = filter.olderThan;
	}

	if (filter.newerThan) {
		range['$gt'] = filter.newerThan;
	}

	query['createdAt'] = range;
}

function applyCursorDateRanges(query: Filter<Document>, filter: CursorQueryFilter): void {
	if ('createdAtFrom' in filter || 'createdAtTo' in filter) {
		applyDateRange(query, 'createdAt', filter.createdAtFrom, filter.createdAtTo);
	}

	if ('updatedAtFrom' in filter || 'updatedAtTo' in filter) {
		applyDateRange(query, 'updatedAt', filter.updatedAtFrom, filter.updatedAtTo);
	}

	if ('nextRunAtFrom' in filter || 'nextRunAtTo' in filter) {
		applyDateRange(query, 'nextRunAt', filter.nextRunAtFrom, filter.nextRunAtTo);
	}
}

function applyDateRange(
	query: Filter<Document>,
	field: DateRangeField,
	from?: Date,
	to?: Date,
): void {
	if (!from && !to) {
		return;
	}

	const range = getDateRange(query, field);

	if (from) {
		range['$gte'] = from;
	}

	if (to) {
		range['$lte'] = to;
	}

	query[field] = range;
}

function getDateRange(query: Filter<Document>, field: DateRangeField): DateRangeQuery {
	const existing = query[field];

	if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
		return existing as DateRangeQuery;
	}

	return {};
}

/**
 * Encode an ObjectId and direction into an opaque cursor string.
 *
 * Format: `prefix` + `base64url(objectId)`
 * Prefix: 'F' (forward) or 'B' (backward)
 *
 * @param id - The job ID to use as the cursor anchor (exclusive)
 * @param direction - 'forward' or 'backward'
 * @returns Base64url-encoded cursor string
 */
export function encodeCursor(
	id: ObjectId,
	direction: CursorDirectionType,
	sort: JobCursorSort = DEFAULT_CURSOR_SORT,
	sortValue?: Date,
): string {
	const prefix = direction === CursorDirection.FORWARD ? 'F' : 'B';

	if (
		sort.by === JobCursorSortField.IDENTIFIER &&
		sort.direction === JobCursorSortDirection.ASC &&
		sortValue === undefined
	) {
		const buffer = Buffer.from(id.toHexString(), 'hex');

		return prefix + buffer.toString('base64url');
	}

	if (sort.by !== JobCursorSortField.IDENTIFIER && sortValue === undefined) {
		throw new InvalidCursorError('Cursor sort value is required');
	}

	const payload: EncodedCursorPayload = {
		id: id.toHexString(),
		sort: {
			by: sort.by,
			direction: sort.direction,
			value: (sortValue ?? new Date(id.getTimestamp())).toISOString(),
		},
	};
	const buffer = Buffer.from(JSON.stringify(payload), 'utf8');

	return prefix + buffer.toString('base64url');
}

/**
 * Decode an opaque cursor string into an ObjectId and direction.
 *
 * Validates format and returns the components.
 *
 * @param cursor - The opaque cursor string
 * @returns The decoded ID and direction
 * @throws {InvalidCursorError} If the cursor format is invalid or ID is malformed
 */
export function decodeCursor(cursor: string): DecodedCursor {
	if (!cursor || cursor.length < 2) {
		throw new InvalidCursorError('Cursor is empty or too short');
	}

	const prefix = cursor.charAt(0);
	const payload = cursor.slice(1);

	let direction: CursorDirectionType;

	if (prefix === 'F') {
		direction = CursorDirection.FORWARD;
	} else if (prefix === 'B') {
		direction = CursorDirection.BACKWARD;
	} else {
		throw new InvalidCursorError(`Invalid cursor prefix: ${prefix}`);
	}

	try {
		const buffer = Buffer.from(payload, 'base64url');

		if (buffer.byteLength === LEGACY_CURSOR_PAYLOAD_BYTES) {
			return {
				id: new ObjectId(buffer.toString('hex')),
				direction,
			};
		}

		if (buffer[0] === STRUCTURED_CURSOR_PAYLOAD_PREFIX) {
			return decodeStructuredCursor(buffer.toString('utf8'), direction);
		}

		throw new InvalidCursorError('Invalid length');
	} catch (error) {
		if (error instanceof InvalidCursorError) {
			throw error;
		}
		throw new InvalidCursorError('Invalid cursor payload');
	}
}

export function normalizeCursorSort(sort?: JobCursorSort): JobCursorSort {
	return sort ?? DEFAULT_CURSOR_SORT;
}

function decodeStructuredCursor(
	jsonPayload: string,
	direction: CursorDirectionType,
): DecodedCursor {
	let payload: unknown;

	try {
		payload = JSON.parse(jsonPayload);
	} catch {
		throw new InvalidCursorError('Invalid cursor payload');
	}

	if (!isRecord(payload) || !isRecord(payload['sort'])) {
		throw new InvalidCursorError('Invalid cursor payload');
	}

	const id = payload['id'];
	const sort = payload['sort'];
	const sortBy = sort['by'];
	const sortDirection = sort['direction'];
	const sortValueRaw = sort['value'];

	if (
		typeof id !== 'string' ||
		typeof sortValueRaw !== 'string' ||
		!ObjectId.isValid(id) ||
		!isValidCursorSortField(sortBy) ||
		!isValidCursorSortDirection(sortDirection)
	) {
		throw new InvalidCursorError('Invalid cursor payload');
	}

	const sortValue = new Date(sortValueRaw);

	if (Number.isNaN(sortValue.getTime())) {
		throw new InvalidCursorError('Invalid cursor payload');
	}

	return {
		id: new ObjectId(id),
		direction,
		sort: {
			by: sortBy,
			direction: sortDirection,
			value: sortValue,
		},
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidCursorSortField(value: unknown): value is JobCursorSortFieldType {
	return Object.values(JobCursorSortField).includes(value as JobCursorSortFieldType);
}

function isValidCursorSortDirection(value: unknown): value is JobCursorSortDirectionType {
	return Object.values(JobCursorSortDirection).includes(value as JobCursorSortDirectionType);
}
