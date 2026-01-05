import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { calculateBackoff, calculateBackoffDelay, DEFAULT_BASE_INTERVAL } from '@/shared';

describe('backoff', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe('DEFAULT_BASE_INTERVAL', () => {
		it('should be 1000ms (1 second)', () => {
			expect(DEFAULT_BASE_INTERVAL).toBe(1000);
		});
	});

	describe('calculateBackoffDelay', () => {
		it('should calculate delay for failCount=0 as 2^0 * 1000 = 1000ms', () => {
			expect(calculateBackoffDelay(0)).toBe(1000);
		});

		it('should calculate delay for failCount=1 as 2^1 * 1000 = 2000ms', () => {
			expect(calculateBackoffDelay(1)).toBe(2000);
		});

		it('should calculate delay for failCount=2 as 2^2 * 1000 = 4000ms', () => {
			expect(calculateBackoffDelay(2)).toBe(4000);
		});

		it('should calculate delay for failCount=3 as 2^3 * 1000 = 8000ms', () => {
			expect(calculateBackoffDelay(3)).toBe(8000);
		});

		it('should calculate delay for failCount=10 as 2^10 * 1000 = 1024000ms', () => {
			expect(calculateBackoffDelay(10)).toBe(1024000);
		});

		it('should use custom base interval when provided', () => {
			expect(calculateBackoffDelay(1, 500)).toBe(1000); // 2^1 * 500
			expect(calculateBackoffDelay(2, 500)).toBe(2000); // 2^2 * 500
			expect(calculateBackoffDelay(3, 500)).toBe(4000); // 2^3 * 500
		});

		it('should handle zero base interval', () => {
			expect(calculateBackoffDelay(5, 0)).toBe(0);
		});

		it('should cap delay at maxDelay when provided', () => {
			expect(calculateBackoffDelay(10, 1000, 60000)).toBe(60000); // 1024000 > 60000
			expect(calculateBackoffDelay(1, 1000, 60000)).toBe(2000); // 2000 < 60000
		});
	});

	describe('calculateBackoff', () => {
		it('should return Date with delay for failCount=1', () => {
			const now = Date.now();
			const result = calculateBackoff(1);
			const expectedDelay = 2000; // 2^1 * 1000

			expect(result).toBeInstanceOf(Date);
			expect(result.getTime()).toBe(now + expectedDelay);
		});

		it('should return Date with delay for failCount=2', () => {
			const now = Date.now();
			const result = calculateBackoff(2);
			const expectedDelay = 4000; // 2^2 * 1000

			expect(result.getTime()).toBe(now + expectedDelay);
		});

		it('should return Date with delay for failCount=5', () => {
			const now = Date.now();
			const result = calculateBackoff(5);
			const expectedDelay = 32000; // 2^5 * 1000

			expect(result.getTime()).toBe(now + expectedDelay);
		});

		it('should use custom base interval', () => {
			const now = Date.now();
			const result = calculateBackoff(3, 2000);
			const expectedDelay = 16000; // 2^3 * 2000

			expect(result.getTime()).toBe(now + expectedDelay);
		});

		it('should use default base interval when not provided', () => {
			const now = Date.now();
			const result = calculateBackoff(4);
			const expectedDelay = 16000; // 2^4 * 1000 (DEFAULT_BASE_INTERVAL)

			expect(result.getTime()).toBe(now + expectedDelay);
		});

		it('should calculate proper exponential progression', () => {
			const now = Date.now();

			// Verify exponential growth pattern
			const delays = [0, 1, 2, 3, 4, 5].map((failCount) => {
				const result = calculateBackoff(failCount);
				return result.getTime() - now;
			});

			expect(delays).toEqual([
				1000, // 2^0 * 1000
				2000, // 2^1 * 1000
				4000, // 2^2 * 1000
				8000, // 2^3 * 1000
				16000, // 2^4 * 1000
				32000, // 2^5 * 1000
			]);
		});

		it('should handle large failCount values', () => {
			const now = Date.now();
			const result = calculateBackoff(15);
			const expectedDelay = 32768000; // 2^15 * 1000 = ~32768 seconds

			expect(result.getTime()).toBe(now + expectedDelay);
		});

		it('should cap delay at maxDelay when provided', () => {
			const now = Date.now();
			const result = calculateBackoff(10, 1000, 60000);
			const expectedDelay = 60000; // Capped at 60000ms

			expect(result.getTime()).toBe(now + expectedDelay);
		});
	});
});
