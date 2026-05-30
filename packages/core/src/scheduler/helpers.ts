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

/**
 * Build a MongoDB query filter from a JobSelector.
 *
 * Translates the high-level `JobSelector` interface into a MongoDB `Filter<Document>`.
 * Handles array values for status (using `$in`) and date range filtering.
 *
 * @param filter - The user-provided job selector
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

	if ('olderThan' in filter || 'newerThan' in filter) {
		query['createdAt'] = {};
		if (filter.olderThan) {
			query['createdAt']['$lt'] = filter.olderThan;
		}
		if (filter.newerThan) {
			query['createdAt']['$gt'] = filter.newerThan;
		}
	}

	applyDateRange(query, 'createdAt', 'createdAtFrom' in filter ? filter.createdAtFrom : undefined);
	applyDateRange(
		query,
		'createdAt',
		undefined,
		'createdAtTo' in filter ? filter.createdAtTo : undefined,
	);
	applyDateRange(query, 'updatedAt', 'updatedAtFrom' in filter ? filter.updatedAtFrom : undefined);
	applyDateRange(
		query,
		'updatedAt',
		undefined,
		'updatedAtTo' in filter ? filter.updatedAtTo : undefined,
	);
	applyDateRange(query, 'nextRunAt', 'nextRunAtFrom' in filter ? filter.nextRunAtFrom : undefined);
	applyDateRange(
		query,
		'nextRunAt',
		undefined,
		'nextRunAtTo' in filter ? filter.nextRunAtTo : undefined,
	);

	return query;
}

function applyDateRange(
	query: Filter<Document>,
	field: 'createdAt' | 'updatedAt' | 'nextRunAt',
	from?: Date,
	to?: Date,
): void {
	if (!from && !to) {
		return;
	}

	const existing = query[field];
	const range =
		existing && typeof existing === 'object' && !Array.isArray(existing)
			? (existing as Record<string, Date>)
			: {};

	if (from) {
		range['$gte'] = from;
	}

	if (to) {
		range['$lte'] = to;
	}

	query[field] = range;
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
	const prefix = direction === 'forward' ? 'F' : 'B';

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
		const jsonPayload = buffer.toString('utf8');

		if (looksLikeJsonPayload(jsonPayload)) {
			return decodeStructuredCursor(jsonPayload, direction);
		}

		const hex = buffer.toString('hex');
		if (hex.length !== 24) {
			throw new InvalidCursorError('Invalid length');
		}

		const id = new ObjectId(hex);

		return { id, direction };
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

function looksLikeJsonPayload(value: string): boolean {
	return value.startsWith('{');
}

function decodeStructuredCursor(
	jsonPayload: string,
	direction: CursorDirectionType,
): DecodedCursor {
	let payload: EncodedCursorPayload;

	try {
		payload = JSON.parse(jsonPayload) as EncodedCursorPayload;
	} catch {
		throw new InvalidCursorError('Invalid cursor payload');
	}

	if (
		typeof payload.id !== 'string' ||
		!ObjectId.isValid(payload.id) ||
		payload.sort === undefined ||
		!isValidCursorSortField(payload.sort.by) ||
		!isValidCursorSortDirection(payload.sort.direction)
	) {
		throw new InvalidCursorError('Invalid cursor payload');
	}

	const sortValue = new Date(payload.sort.value);

	if (Number.isNaN(sortValue.getTime())) {
		throw new InvalidCursorError('Invalid cursor payload');
	}

	return {
		id: new ObjectId(payload.id),
		direction,
		sort: {
			by: payload.sort.by,
			direction: payload.sort.direction,
			value: sortValue,
		},
	};
}

function isValidCursorSortField(value: unknown): value is JobCursorSortFieldType {
	return Object.values(JobCursorSortField).includes(value as JobCursorSortFieldType);
}

function isValidCursorSortDirection(value: unknown): value is JobCursorSortDirectionType {
	return Object.values(JobCursorSortDirection).includes(value as JobCursorSortDirectionType);
}
