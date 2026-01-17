import { type Document, type Filter, ObjectId } from 'mongodb';

import { CursorDirection, type CursorDirectionType, type JobSelector } from '@/jobs';
import { InvalidCursorError } from '@/shared';

/**
 * Build a MongoDB query filter from a JobSelector.
 *
 * Translates the high-level `JobSelector` interface into a MongoDB `Filter<Document>`.
 * Handles array values for status (using `$in`) and date range filtering.
 *
 * @param filter - The user-provided job selector
 * @returns A standard MongoDB filter object
 */
export function buildSelectorQuery(filter: JobSelector): Filter<Document> {
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

	if (filter.olderThan || filter.newerThan) {
		query['createdAt'] = {};
		if (filter.olderThan) {
			query['createdAt'].$lt = filter.olderThan;
		}
		if (filter.newerThan) {
			query['createdAt'].$gt = filter.newerThan;
		}
	}

	return query;
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
export function encodeCursor(id: ObjectId, direction: CursorDirectionType): string {
	const prefix = direction === 'forward' ? 'F' : 'B';
	const buffer = Buffer.from(id.toHexString(), 'hex');

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
export function decodeCursor(cursor: string): {
	id: ObjectId;
	direction: CursorDirectionType;
} {
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
		const hex = buffer.toString('hex');
		// standard ObjectID is 12 bytes = 24 hex chars
		if (hex.length !== 24) {
			throw new Error('Invalid length');
		}

		const id = new ObjectId(hex);

		return { id, direction };
	} catch (_error) {
		throw new InvalidCursorError('Invalid cursor payload');
	}
}
