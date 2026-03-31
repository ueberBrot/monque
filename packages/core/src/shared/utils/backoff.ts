/**
 * Default base interval for exponential backoff in milliseconds.
 * @default 1000
 */
export const DEFAULT_BASE_INTERVAL = 1000;

/**
 * Default maximum delay cap for exponential backoff in milliseconds.
 *
 * This prevents unbounded delays (e.g. failCount=20 is >11 days at 1s base)
 * and avoids precision/overflow issues for very large fail counts.
 * @default 86400000 (24 hours)
 */
export const DEFAULT_MAX_BACKOFF_DELAY = 24 * 60 * 60 * 1_000;

/**
 * Default jitter factor applied to backoff delays.
 *
 * A factor of 0.25 means the delay is randomly spread ±25% around the
 * calculated value. This prevents thundering-herd retries when many jobs
 * fail simultaneously with the same `failCount`.
 *
 * @default 0.25
 */
export const DEFAULT_JITTER_FACTOR = 0.25;

/**
 * Apply random jitter to a delay value.
 *
 * Spreads the delay uniformly within `[delay × (1 - factor), delay × (1 + factor)]`.
 * The result is always ≥ 0.
 *
 * @param delay - Base delay in milliseconds
 * @param factor - Jitter factor (0–1). 0 = no jitter, 0.25 = ±25%
 * @returns Jittered delay in milliseconds (integer)
 *
 * @example
 * ```typescript
 * // With factor 0.25 and delay 4000:
 * // result is in [3000, 5000]
 * const jittered = applyJitter(4000, 0.25);
 * ```
 */
export function applyJitter(delay: number, factor: number): number {
	if (factor <= 0 || delay <= 0) {
		return delay;
	}

	const spread = delay * factor;
	// Uniform random in [-spread, +spread]
	const jitter = (Math.random() * 2 - 1) * spread;
	return Math.max(0, Math.round(delay + jitter));
}

/**
 * Calculate the next run time using exponential backoff with jitter.
 *
 * Formula: nextRunAt = now + jitter(2^failCount × baseInterval)
 *
 * Jitter (±25% by default) is applied to prevent thundering-herd retries
 * when multiple jobs fail at the same time with the same fail count.
 *
 * @param failCount - Number of previous failed attempts
 * @param baseInterval - Base interval in milliseconds (default: 1000ms)
 * @param maxDelay - Maximum delay in milliseconds (optional)
 * @param jitterFactor - Jitter spread factor, 0–1 (default: 0.25 = ±25%). Set to 0 to disable.
 * @returns The next run date
 *
 * @example
 * ```typescript
 * // First retry (failCount=1): ~2000ms ±25% delay
 * const nextRun = calculateBackoff(1);
 *
 * // With no jitter (deterministic)
 * const nextRun = calculateBackoff(1, 1000, undefined, 0);
 * ```
 */
export function calculateBackoff(
	failCount: number,
	baseInterval: number = DEFAULT_BASE_INTERVAL,
	maxDelay?: number,
	jitterFactor: number = DEFAULT_JITTER_FACTOR,
): Date {
	const delay = calculateBackoffDelay(failCount, baseInterval, maxDelay, jitterFactor);
	return new Date(Date.now() + delay);
}

/**
 * Calculate just the delay in milliseconds for a given fail count, with jitter.
 *
 * @param failCount - Number of previous failed attempts
 * @param baseInterval - Base interval in milliseconds (default: 1000ms)
 * @param maxDelay - Maximum delay in milliseconds (optional)
 * @param jitterFactor - Jitter spread factor, 0–1 (default: 0.25 = ±25%). Set to 0 to disable.
 * @returns The delay in milliseconds
 */
export function calculateBackoffDelay(
	failCount: number,
	baseInterval: number = DEFAULT_BASE_INTERVAL,
	maxDelay?: number,
	jitterFactor: number = DEFAULT_JITTER_FACTOR,
): number {
	const effectiveMaxDelay = maxDelay ?? DEFAULT_MAX_BACKOFF_DELAY;
	let delay = 2 ** failCount * baseInterval;

	if (delay > effectiveMaxDelay) {
		delay = effectiveMaxDelay;
	}

	return applyJitter(delay, jitterFactor);
}
