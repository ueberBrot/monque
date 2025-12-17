import { parseExpression } from 'cron-parser';
import { InvalidCronError } from '../errors.js';

/**
 * Parse a cron expression and return the next scheduled run date.
 *
 * @param expression - A 5-field cron expression (minute hour day-of-month month day-of-week)
 * @param currentDate - The reference date for calculating next run (default: now)
 * @returns The next scheduled run date
 * @throws {InvalidCronError} If the cron expression is invalid
 *
 * @example
 * ```typescript
 * // Every minute
 * const nextRun = getNextCronDate('* * * * *');
 *
 * // Every day at midnight
 * const nextRun = getNextCronDate('0 0 * * *');
 *
 * // Every Monday at 9am
 * const nextRun = getNextCronDate('0 9 * * 1');
 * ```
 */
export function getNextCronDate(expression: string, currentDate?: Date): Date {
	try {
		const interval = parseExpression(expression, {
			currentDate: currentDate ?? new Date(),
		});
		return interval.next().toDate();
	} catch (error) {
		/* istanbul ignore next -- @preserve cron-parser always throws Error objects */
		const errorMessage = error instanceof Error ? error.message : 'Unknown parsing error';
		throw new InvalidCronError(
			expression,
			`Invalid cron expression "${expression}": ${errorMessage}. ` +
				'Expected 5-field format: "minute hour day-of-month month day-of-week". ' +
				'Example: "0 9 * * 1" (every Monday at 9am)',
		);
	}
}

/**
 * Validate a cron expression without calculating the next run date.
 *
 * @param expression - A 5-field cron expression
 * @returns true if valid
 * @throws {InvalidCronError} If the cron expression is invalid
 *
 * @example
 * ```typescript
 * if (validateCronExpression('0 9 * * 1')) {
 *   // Expression is valid
 * }
 * ```
 */
export function validateCronExpression(expression: string): boolean {
	try {
		parseExpression(expression);
		return true;
	} catch (error) {
		/* istanbul ignore next -- @preserve cron-parser always throws Error objects */
		const errorMessage = error instanceof Error ? error.message : 'Unknown parsing error';
		throw new InvalidCronError(
			expression,
			`Invalid cron expression "${expression}": ${errorMessage}. ` +
				'Expected 5-field format: "minute hour day-of-month month day-of-week". ' +
				'Example: "0 9 * * 1" (every Monday at 9am)',
		);
	}
}
