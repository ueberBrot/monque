import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	applyJitter,
	calculateBackoff,
	calculateBackoffDelay,
	DEFAULT_BASE_INTERVAL,
	DEFAULT_JITTER_FACTOR,
	DEFAULT_MAX_BACKOFF_DELAY,
} from '@/shared';

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

	describe('DEFAULT_MAX_BACKOFF_DELAY', () => {
		it('should be 24 hours', () => {
			expect(DEFAULT_MAX_BACKOFF_DELAY).toBe(24 * 60 * 60 * 1_000);
		});
	});

	describe('DEFAULT_JITTER_FACTOR', () => {
		it('should be 0.25 (±25%)', () => {
			expect(DEFAULT_JITTER_FACTOR).toBe(0.25);
		});
	});

	describe('applyJitter', () => {
		it('should return the original delay when factor is 0', () => {
			expect(applyJitter(4000, 0)).toBe(4000);
		});

		it('should return the original delay when delay is 0', () => {
			expect(applyJitter(0, 0.25)).toBe(0);
		});

		it('should return 0 when factor is negative', () => {
			expect(applyJitter(4000, -0.1)).toBe(4000);
		});

		it('should return a value within ±factor range', () => {
			const delay = 10000;
			const factor = 0.25;
			const minExpected = delay * (1 - factor); // 7500
			const maxExpected = delay * (1 + factor); // 12500

			// Run multiple times to verify range
			for (let i = 0; i < 100; i++) {
				const result = applyJitter(delay, factor);
				expect(result).toBeGreaterThanOrEqual(minExpected);
				expect(result).toBeLessThanOrEqual(maxExpected);
			}
		});

		it('should never return a negative value', () => {
			// Even with factor=1.0 (±100%), result should be clamped to 0
			for (let i = 0; i < 100; i++) {
				const result = applyJitter(100, 1.0);
				expect(result).toBeGreaterThanOrEqual(0);
			}
		});

		it('should return an integer', () => {
			for (let i = 0; i < 50; i++) {
				const result = applyJitter(3333, 0.25);
				expect(Number.isInteger(result)).toBe(true);
			}
		});

		it('should produce varied values (not always the same)', () => {
			const results = new Set<number>();
			for (let i = 0; i < 50; i++) {
				results.add(applyJitter(10000, 0.25));
			}
			// With 50 samples of a continuous distribution, we expect many unique values
			expect(results.size).toBeGreaterThan(1);
		});
	});

	describe('calculateBackoffDelay', () => {
		it('should calculate delay for failCount=0 with jitter disabled', () => {
			expect(calculateBackoffDelay(0, 1000, undefined, 0)).toBe(1000);
		});

		it('should calculate delay for failCount=1 with jitter disabled', () => {
			expect(calculateBackoffDelay(1, 1000, undefined, 0)).toBe(2000);
		});

		it('should calculate delay for failCount=2 with jitter disabled', () => {
			expect(calculateBackoffDelay(2, 1000, undefined, 0)).toBe(4000);
		});

		it('should calculate delay for failCount=3 with jitter disabled', () => {
			expect(calculateBackoffDelay(3, 1000, undefined, 0)).toBe(8000);
		});

		it('should calculate delay for failCount=10 with jitter disabled', () => {
			expect(calculateBackoffDelay(10, 1000, undefined, 0)).toBe(1024000);
		});

		it('should use custom base interval when provided', () => {
			expect(calculateBackoffDelay(1, 500, undefined, 0)).toBe(1000); // 2^1 * 500
			expect(calculateBackoffDelay(2, 500, undefined, 0)).toBe(2000); // 2^2 * 500
			expect(calculateBackoffDelay(3, 500, undefined, 0)).toBe(4000); // 2^3 * 500
		});

		it('should handle zero base interval', () => {
			expect(calculateBackoffDelay(5, 0, undefined, 0)).toBe(0);
		});

		it('should cap delay at maxDelay when provided', () => {
			expect(calculateBackoffDelay(10, 1000, 60000, 0)).toBe(60000); // 1024000 > 60000
			expect(calculateBackoffDelay(1, 1000, 60000, 0)).toBe(2000); // 2000 < 60000
		});

		it('should cap delay at DEFAULT_MAX_BACKOFF_DELAY by default', () => {
			// 2^20 * 1000ms = 1,048,576,000ms (~12.1 days) > 24h
			expect(calculateBackoffDelay(20, 1000, undefined, 0)).toBe(DEFAULT_MAX_BACKOFF_DELAY);
		});

		it('should apply jitter by default', () => {
			const baseDelay = 2 ** 3 * 1000; // 8000
			const results = new Set<number>();

			for (let i = 0; i < 50; i++) {
				results.add(calculateBackoffDelay(3));
			}

			// Default jitter (±25%) means values should vary
			expect(results.size).toBeGreaterThan(1);

			// All values should be within ±25% of base delay
			for (const result of results) {
				expect(result).toBeGreaterThanOrEqual(baseDelay * 0.75);
				expect(result).toBeLessThanOrEqual(baseDelay * 1.25);
			}
		});

		it('should apply jitter after cap', () => {
			// With maxDelay=60000 and jitter=0.25, range is [45000, 75000]
			const results = new Set<number>();

			for (let i = 0; i < 50; i++) {
				results.add(calculateBackoffDelay(20, 1000, 60000, 0.25));
			}

			for (const result of results) {
				expect(result).toBeGreaterThanOrEqual(60000 * 0.75);
				expect(result).toBeLessThanOrEqual(60000 * 1.25);
			}
		});
	});

	describe('calculateBackoff', () => {
		it('should return Date with delay for failCount=1 (jitter disabled)', () => {
			const now = Date.now();
			const result = calculateBackoff(1, 1000, undefined, 0);
			const expectedDelay = 2000; // 2^1 * 1000

			expect(result).toBeInstanceOf(Date);
			expect(result.getTime()).toBe(now + expectedDelay);
		});

		it('should return Date with delay for failCount=2 (jitter disabled)', () => {
			const now = Date.now();
			const result = calculateBackoff(2, 1000, undefined, 0);
			const expectedDelay = 4000; // 2^2 * 1000

			expect(result.getTime()).toBe(now + expectedDelay);
		});

		it('should return Date with delay for failCount=5 (jitter disabled)', () => {
			const now = Date.now();
			const result = calculateBackoff(5, 1000, undefined, 0);
			const expectedDelay = 32000; // 2^5 * 1000

			expect(result.getTime()).toBe(now + expectedDelay);
		});

		it('should use custom base interval', () => {
			const now = Date.now();
			const result = calculateBackoff(3, 2000, undefined, 0);
			const expectedDelay = 16000; // 2^3 * 2000

			expect(result.getTime()).toBe(now + expectedDelay);
		});

		it('should use default base interval when not provided (jitter disabled)', () => {
			const now = Date.now();
			const result = calculateBackoff(4, undefined, undefined, 0);
			const expectedDelay = 16000; // 2^4 * 1000 (DEFAULT_BASE_INTERVAL)

			expect(result.getTime()).toBe(now + expectedDelay);
		});

		it('should calculate proper exponential progression (jitter disabled)', () => {
			const now = Date.now();

			// Verify exponential growth pattern
			const delays = [0, 1, 2, 3, 4, 5].map((failCount) => {
				const result = calculateBackoff(failCount, 1000, undefined, 0);
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

		it('should handle large failCount values (jitter disabled)', () => {
			const now = Date.now();
			const result = calculateBackoff(15, 1000, undefined, 0);
			const expectedDelay = 32768000; // 2^15 * 1000 = ~32768 seconds

			expect(result.getTime()).toBe(now + expectedDelay);
		});

		it('should cap delay at maxDelay when provided (jitter disabled)', () => {
			const now = Date.now();
			const result = calculateBackoff(10, 1000, 60000, 0);
			const expectedDelay = 60000; // Capped at 60000ms

			expect(result.getTime()).toBe(now + expectedDelay);
		});

		it('should cap delay at DEFAULT_MAX_BACKOFF_DELAY by default (jitter disabled)', () => {
			const now = Date.now();
			const result = calculateBackoff(20, 1000, undefined, 0);
			expect(result.getTime()).toBe(now + DEFAULT_MAX_BACKOFF_DELAY);
		});

		it('should apply jitter by default', () => {
			const now = Date.now();
			const baseDelay = 2 ** 3 * 1000; // 8000
			const results = new Set<number>();

			for (let i = 0; i < 50; i++) {
				const result = calculateBackoff(3);
				results.add(result.getTime() - now);
			}

			expect(results.size).toBeGreaterThan(1);

			for (const delay of results) {
				expect(delay).toBeGreaterThanOrEqual(baseDelay * 0.75);
				expect(delay).toBeLessThanOrEqual(baseDelay * 1.25);
			}
		});
	});
});
