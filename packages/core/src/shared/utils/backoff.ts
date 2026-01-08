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
 * Calculate the next run time using exponential backoff.
 *
 * Formula: nextRunAt = now + (2^failCount × baseInterval)
 *
 * @param failCount - Number of previous failed attempts
 * @param baseInterval - Base interval in milliseconds (default: 1000ms)
 * @param maxDelay - Maximum delay in milliseconds (optional)
 * @returns The next run date
 *
 * @example
 * ```typescript
 * // First retry (failCount=1): 2^1 * 1000 = 2000ms delay
 * const nextRun = calculateBackoff(1);
 *
 * // Second retry (failCount=2): 2^2 * 1000 = 4000ms delay
 * const nextRun = calculateBackoff(2);
 *
 * // With custom base interval
 * const nextRun = calculateBackoff(3, 500); // 2^3 * 500 = 4000ms delay
 *
 * // With max delay
 * const nextRun = calculateBackoff(10, 1000, 60000); // capped at 60000ms
 * ```
 */
export function calculateBackoff(
	failCount: number,
	baseInterval: number = DEFAULT_BASE_INTERVAL,
	maxDelay?: number,
): Date {
	const effectiveMaxDelay = maxDelay ?? DEFAULT_MAX_BACKOFF_DELAY;
	let delay = 2 ** failCount * baseInterval;

	if (delay > effectiveMaxDelay) {
		delay = effectiveMaxDelay;
	}

	return new Date(Date.now() + delay);
}

/**
 * Calculate just the delay in milliseconds for a given fail count.
 *
 * @param failCount - Number of previous failed attempts
 * @param baseInterval - Base interval in milliseconds (default: 1000ms)
 * @param maxDelay - Maximum delay in milliseconds (optional)
 * @returns The delay in milliseconds
 */
export function calculateBackoffDelay(
	failCount: number,
	baseInterval: number = DEFAULT_BASE_INTERVAL,
	maxDelay?: number,
): number {
	const effectiveMaxDelay = maxDelay ?? DEFAULT_MAX_BACKOFF_DELAY;
	let delay = 2 ** failCount * baseInterval;

	if (delay > effectiveMaxDelay) {
		delay = effectiveMaxDelay;
	}

	return delay;
}
