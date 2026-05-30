import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { CursorDirection, JobCursorSortDirection, JobCursorSortField } from '@/jobs';
import { decodeCursor, encodeCursor } from '@/scheduler/helpers.js';
import { InvalidCursorError } from '@/shared';

describe('cursor pagination helpers', () => {
	describe('encodeCursor', () => {
		it('should encode forward cursor with F prefix', () => {
			const id = new ObjectId('507f1f77bcf86cd799439011');
			const cursor = encodeCursor(id, CursorDirection.FORWARD);

			expect(cursor.startsWith('F')).toBe(true);
			// Verify it's base64url compatible
			expect(cursor).not.toContain('+');
			expect(cursor).not.toContain('/');
			expect(cursor).not.toContain('=');
		});

		it('should encode backward cursor with B prefix', () => {
			const id = new ObjectId('507f1f77bcf86cd799439011');
			const cursor = encodeCursor(id, CursorDirection.BACKWARD);

			expect(cursor.startsWith('B')).toBe(true);
		});

		it('should be deterministic', () => {
			const id = new ObjectId('507f1f77bcf86cd799439011');
			const cursor1 = encodeCursor(id, CursorDirection.FORWARD);
			const cursor2 = encodeCursor(id, CursorDirection.FORWARD);

			expect(cursor1).toBe(cursor2);
		});
	});

	describe('decodeCursor', () => {
		it('should decode forward cursor correctly', () => {
			const id = new ObjectId('507f1f77bcf86cd799439011');
			const cursor = encodeCursor(id, CursorDirection.FORWARD);

			const result = decodeCursor(cursor);

			expect(result.direction).toBe(CursorDirection.FORWARD);
			expect(result.id.equals(id)).toBe(true);
		});

		it('should decode backward cursor correctly', () => {
			const id = new ObjectId('507f1f77bcf86cd799439011');
			const cursor = encodeCursor(id, CursorDirection.BACKWARD);

			const result = decodeCursor(cursor);

			expect(result.direction).toBe(CursorDirection.BACKWARD);
			expect(result.id.equals(id)).toBe(true);
		});

		it('should decode legacy ObjectId cursors whose bytes start like JSON', () => {
			const id = new ObjectId('7b0000000000000000000000');
			const cursor = encodeCursor(id, CursorDirection.FORWARD);

			const result = decodeCursor(cursor);

			expect(result.direction).toBe(CursorDirection.FORWARD);
			expect(result.id.equals(id)).toBe(true);
		});

		it('should throw InvalidCursorError for empty cursor', () => {
			expect(() => decodeCursor('')).toThrow(InvalidCursorError);
		});

		it('should throw InvalidCursorError for cursor with invalid prefix', () => {
			const id = new ObjectId();
			const invalidPrefixCursor = `X${Buffer.from(id.toHexString(), 'hex').toString('base64url')}`;

			expect(() => decodeCursor(invalidPrefixCursor)).toThrow(InvalidCursorError);
		});

		it('should throw InvalidCursorError for malformed base64 payload', () => {
			const cursor = 'F!!!InvalidBase64!!!';
			expect(() => decodeCursor(cursor)).toThrow(InvalidCursorError);
		});

		it('should throw InvalidCursorError for valid base64 but invalid ObjectId length', () => {
			const shortId = Buffer.from('1234', 'hex').toString('base64url');
			const cursor = `F${shortId}`;

			expect(() => decodeCursor(cursor)).toThrow(InvalidCursorError);
		});

		it.each([
			{
				name: 'bad sort.by value',
				mutate: (payload: StructuredCursorPayload) => {
					payload.sort.by = 'finishedAt';
				},
			},
			{
				name: 'bad sort.direction value',
				mutate: (payload: StructuredCursorPayload) => {
					payload.sort.direction = 'sideways';
				},
			},
			{
				name: 'non-Date sort.value',
				mutate: (payload: StructuredCursorPayload) => {
					payload.sort.value = 'not-a-date';
				},
			},
			{
				name: 'non-object sort',
				mutate: (payload: StructuredCursorPayload) => {
					Object.assign(payload, { sort: 'updatedAt' });
				},
			},
		])('should throw InvalidCursorError through decodeStructuredCursor with $name', ({
			mutate,
		}) => {
			const cursor = encodeStructuredCursor();
			const prefix = cursor.charAt(0);
			const payload = JSON.parse(
				Buffer.from(cursor.slice(1), 'base64url').toString('utf8'),
			) as StructuredCursorPayload;

			mutate(payload);

			const tamperedCursor = `${prefix}${Buffer.from(JSON.stringify(payload), 'utf8').toString(
				'base64url',
			)}`;

			expect(() => decodeCursor(tamperedCursor)).toThrow(InvalidCursorError);
		});

		it('should throw InvalidCursorError for structured cursor with malformed JSON', () => {
			const cursor = `F${Buffer.from('{', 'utf8').toString('base64url')}`;

			expect(() => decodeCursor(cursor)).toThrow(InvalidCursorError);
		});
	});

	describe('round trip', () => {
		it('should preserve ID and direction after encode/decode', () => {
			const originalId = new ObjectId();
			const encoded = encodeCursor(originalId, CursorDirection.FORWARD);
			const decoded = decodeCursor(encoded);

			expect(decoded.id.toString()).toBe(originalId.toString());
			expect(decoded.direction).toBe(CursorDirection.FORWARD);
		});

		it('should preserve sort metadata for Dashboard-grade cursors', () => {
			const originalId = new ObjectId('507f1f77bcf86cd799439011');
			const sortValue = new Date('2026-02-01T12:00:00.000Z');
			const encoded = encodeCursor(
				originalId,
				CursorDirection.FORWARD,
				{
					by: JobCursorSortField.UPDATED_AT,
					direction: JobCursorSortDirection.DESC,
				},
				sortValue,
			);
			const decoded = decodeCursor(encoded);

			expect(decoded.id.toString()).toBe(originalId.toString());
			expect(decoded.direction).toBe(CursorDirection.FORWARD);
			expect(decoded.sort).toEqual({
				by: JobCursorSortField.UPDATED_AT,
				direction: JobCursorSortDirection.DESC,
				value: sortValue,
			});
		});
	});
});

type StructuredCursorPayload = {
	id: string;
	sort: {
		by: unknown;
		direction: unknown;
		value: unknown;
	};
};

function encodeStructuredCursor(): string {
	return encodeCursor(
		new ObjectId('507f1f77bcf86cd799439011'),
		CursorDirection.FORWARD,
		{
			by: JobCursorSortField.UPDATED_AT,
			direction: JobCursorSortDirection.DESC,
		},
		new Date('2026-02-01T12:00:00.000Z'),
	);
}
