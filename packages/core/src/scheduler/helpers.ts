import { type Document, type Filter, ObjectId } from 'mongodb';

import type { JobSelector } from '@/jobs';
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
 * Encode an ObjectId into an opaque cursor string.
 *
 * The cursor is a pure anchor — it contains only the ObjectId. Direction is
 * always provided separately via `CursorOptions.direction`.
 *
 * @param id - The job ID to use as the cursor anchor (exclusive)
 * @returns Base64url-encoded cursor string
 */
export function encodeCursor(id: ObjectId): string {
	const buffer = Buffer.from(id.toHexString(), 'hex');

	return buffer.toString('base64url');
}

/**
 * Decode an opaque cursor string into an ObjectId.
 *
 * Validates format and returns the anchor ID.
 *
 * @param cursor - The opaque cursor string
 * @returns The decoded ObjectId
 * @throws {InvalidCursorError} If the cursor format is invalid or ID is malformed
 */
export function decodeCursor(cursor: string): ObjectId {
	if (!cursor || cursor.length === 0) {
		throw new InvalidCursorError('Cursor is empty');
	}

	try {
		const buffer = Buffer.from(cursor, 'base64url');
		const hex = buffer.toString('hex');
		// standard ObjectID is 12 bytes = 24 hex chars
		if (hex.length !== 24) {
			throw new InvalidCursorError('Invalid cursor length');
		}

		return new ObjectId(hex);
	} catch (error) {
		if (error instanceof InvalidCursorError) {
			throw error;
		}
		throw new InvalidCursorError('Invalid cursor payload');
	}
}
