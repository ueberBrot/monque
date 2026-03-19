import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { decodeCursor, encodeCursor } from '@/scheduler/helpers.js';
import { InvalidCursorError } from '@/shared';

describe('cursor pagination helpers', () => {
	describe('encodeCursor', () => {
		it('should encode ObjectId as base64url string', () => {
			const id = new ObjectId('507f1f77bcf86cd799439011');
			const cursor = encodeCursor(id);

			// Verify it's base64url compatible
			expect(cursor).not.toContain('+');
			expect(cursor).not.toContain('/');
			expect(cursor).not.toContain('=');
			expect(cursor.length).toBeGreaterThan(0);
		});

		it('should be deterministic', () => {
			const id = new ObjectId('507f1f77bcf86cd799439011');
			const cursor1 = encodeCursor(id);
			const cursor2 = encodeCursor(id);

			expect(cursor1).toBe(cursor2);
		});
	});

	describe('decodeCursor', () => {
		it('should decode cursor to ObjectId', () => {
			const id = new ObjectId('507f1f77bcf86cd799439011');
			const cursor = encodeCursor(id);

			const result = decodeCursor(cursor);

			expect(result.equals(id)).toBe(true);
		});

		it('should throw InvalidCursorError for empty cursor', () => {
			expect(() => decodeCursor('')).toThrow(InvalidCursorError);
		});

		it('should throw InvalidCursorError for malformed base64 payload', () => {
			const cursor = '!!!InvalidBase64!!!';
			expect(() => decodeCursor(cursor)).toThrow(InvalidCursorError);
		});

		it('should throw InvalidCursorError for valid base64 but invalid ObjectId length', () => {
			const shortId = Buffer.from('1234', 'hex').toString('base64url');

			expect(() => decodeCursor(shortId)).toThrow(InvalidCursorError);
		});
	});

	describe('round trip', () => {
		it('should preserve ID after encode/decode', () => {
			const originalId = new ObjectId();
			const encoded = encodeCursor(originalId);
			const decoded = decodeCursor(encoded);

			expect(decoded.toString()).toBe(originalId.toString());
		});
	});
});
