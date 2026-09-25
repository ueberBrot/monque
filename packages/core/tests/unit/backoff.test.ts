import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyJitter, calculateBackoff, calculateBackoffDelay } from '@/shared';

describe('backoff', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	describe('applyJitter', () => {
		it.each([
			{ delay: 4000, factor: 0 },
			{ delay: 0, factor: 0.25 },
			{ delay: 4000, factor: -0.1 },
		])(
			'preserves $delay when jitter is disabled by factor $factor or zero delay',
			({ delay, factor }) => {
				expect(applyJitter(delay, factor)).toBe(delay);
			},
		);

		it.each([
			{ random: 0, expected: 7500 },
			{ random: 0.5, expected: 10000 },
			{ random: 1 - Number.EPSILON, expected: 12500 },
		])(
			'spreads the delay across both bounds and midpoint with random=$random',
			({ random, expected }) => {
				vi.spyOn(Math, 'random').mockReturnValue(random);
				expect(applyJitter(10000, 0.25)).toBe(expected);
			},
		);

		it('clamps negative jittered delays to zero', () => {
			vi.spyOn(Math, 'random').mockReturnValue(0);
			expect(applyJitter(100, 2)).toBe(0);
		});

		it.each([
			{ random: 0, expected: 2500 },
			{ random: 1 - Number.EPSILON, expected: 4166 },
		])('rounds fractional delays with random=$random', ({ random, expected }) => {
			vi.spyOn(Math, 'random').mockReturnValue(random);
			expect(applyJitter(3333, 0.25)).toBe(expected);
		});
	});

	describe('calculateBackoffDelay', () => {
		it('doubles the default one-second base for each failure when jitter is disabled', () => {
			expect(
				[0, 1, 2, 3, 4, 5, 10].map((failures) =>
					calculateBackoffDelay(failures, undefined, undefined, 0),
				),
			).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 1024000]);
		});

		it('supports custom and zero base intervals', () => {
			expect(calculateBackoffDelay(3, 500, undefined, 0)).toBe(4000);
			expect(calculateBackoffDelay(5, 0, undefined, 0)).toBe(0);
		});

		it('caps exponential delays at the configured maximum or 24 hours by default', () => {
			expect(calculateBackoffDelay(1, 1000, 60000, 0)).toBe(2000);
			expect(calculateBackoffDelay(10, 1000, 60000, 0)).toBe(60000);
			expect(calculateBackoffDelay(20, 1000, undefined, 0)).toBe(86_400_000);
		});

		it.each([
			{ random: 0, expected: 6000 },
			{ random: 1 - Number.EPSILON, expected: 10000 },
		])('applies 25 percent jitter by default with random=$random', ({ random, expected }) => {
			vi.spyOn(Math, 'random').mockReturnValue(random);
			expect(calculateBackoffDelay(3)).toBe(expected);
		});

		it.each([
			{ random: 0, expected: 45000 },
			{ random: 1 - Number.EPSILON, expected: 60000 },
		])(
			'jitters the capped delay without exceeding the maximum with random=$random',
			({ random, expected }) => {
				vi.spyOn(Math, 'random').mockReturnValue(random);
				expect(calculateBackoffDelay(20, 1000, 60000, 0.25)).toBe(expected);
			},
		);
	});

	describe('calculateBackoff', () => {
		it('adds the delay to the current clock and forwards custom retry options', () => {
			vi.spyOn(Math, 'random').mockReturnValue(0);
			expect(calculateBackoff(3, 2000, undefined, 0).getTime()).toBe(Date.now() + 16000);
			expect(calculateBackoff(3, 2000, 10000, 0.5).getTime()).toBe(Date.now() + 5000);
			vi.advanceTimersByTime(1234);
			expect(calculateBackoff(3, 2000, 10000, 0).getTime()).toBe(Date.now() + 10000);
		});

		it('uses the default base interval, jitter and maximum', () => {
			vi.spyOn(Math, 'random').mockReturnValue(0);
			expect(calculateBackoff(3).getTime()).toBe(Date.now() + 6000);
			expect(calculateBackoff(20, undefined, undefined, 0).getTime()).toBe(Date.now() + 86_400_000);
		});
	});
});
