import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { decodeCursor, encodeCursor } from '@/scheduler/helpers.js';
import { InvalidCursorError } from '@/shared';

describe('cursor pagination helpers', () => {
	describe('encodeCursor', () => {
		it('should encode forward cursor with F prefix', () => {
			const id = new ObjectId('507f1f77bcf86cd799439011');
			const cursor = encodeCursor(id, 'forward');

			expect(cursor.startsWith('F')).toBe(true);
			// Verify it's base64url compatible
			expect(cursor).not.toContain('+');
			expect(cursor).not.toContain('/');
			expect(cursor).not.toContain('=');
		});

		it('should encode backward cursor with B prefix', () => {
			const id = new ObjectId('507f1f77bcf86cd799439011');
			const cursor = encodeCursor(id, 'backward');

			expect(cursor.startsWith('B')).toBe(true);
		});

		it('should be deterministic', () => {
			const id = new ObjectId('507f1f77bcf86cd799439011');
			const cursor1 = encodeCursor(id, 'forward');
			const cursor2 = encodeCursor(id, 'forward');

			expect(cursor1).toBe(cursor2);
		});
	});

	describe('decodeCursor', () => {
		it('should decode forward cursor correctly', () => {
			const id = new ObjectId('507f1f77bcf86cd799439011');
			const cursor = encodeCursor(id, 'forward');

			const result = decodeCursor(cursor);

			expect(result.direction).toBe('forward');
			expect(result.id.equals(id)).toBe(true);
		});

		it('should decode backward cursor correctly', () => {
			const id = new ObjectId('507f1f77bcf86cd799439011');
			const cursor = encodeCursor(id, 'backward');

			const result = decodeCursor(cursor);

			expect(result.direction).toBe('backward');
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
	});

	describe('round trip', () => {
		it('should preserve ID and direction after encode/decode', () => {
			const originalId = new ObjectId();
			const encoded = encodeCursor(originalId, 'forward');
			const decoded = decodeCursor(encoded);

			expect(decoded.id.toString()).toBe(originalId.toString());
			expect(decoded.direction).toBe('forward');
		});
	});
});
