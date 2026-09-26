import { CronExpressionParser } from 'cron-parser';

import { InvalidCronError } from '../errors.js';

/**
 * Parse a cron expression and return the next scheduled run date.
 *
 * @param expression - A 5-field cron expression (minute hour day-of-month month day-of-week) or a predefined expression
 * @param currentDate - The reference date for calculating next run (default: now)
 * @param timezone - IANA timezone (default: server's local timezone)
 * @returns The next scheduled run date
 * @throws {InvalidCronError} If the cron expression or timezone is invalid
 *
 * @example
 * ```typescript
 * // Every minute
 * const nextRun = getNextCronDate('* * * * *');
 *
 * // Every day at midnight
 * const nextRun = getNextCronDate('0 0 * * *');
 *
 * // Using predefined expression
 * const nextRun = getNextCronDate('@daily');
 *
 * // Every Monday at 9am
 * const nextRun = getNextCronDate('0 9 * * 1');
 * ```
 */
export function getNextCronDate(expression: string, currentDate?: Date, timezone?: string): Date {
	if (timezone !== undefined) {
		try {
			if (timezone.startsWith('+') || timezone.startsWith('-')) {
				throw new RangeError('Fixed offsets are not IANA timezone identifiers');
			}
			// Intl rejects host-relative aliases such as Luxon's "local" and "system".
			new Intl.DateTimeFormat('en', { timeZone: timezone });
		} catch {
			throw new InvalidCronError(
				expression,
				`Invalid timezone "${timezone}". Expected an IANA timezone such as "Europe/Berlin" or "UTC".`,
			);
		}
	}

	try {
		const interval = CronExpressionParser.parse(expression, {
			currentDate: currentDate ?? new Date(),
			...(timezone === undefined ? {} : { tz: timezone }),
		});
		return interval.next().toDate();
	} catch (error) {
		handleCronParseError(expression, error);
	}
}

/**
 * Validate a cron expression without calculating the next run date.
 *
 * @param expression - A 5-field cron expression
 * @throws {InvalidCronError} If the cron expression is invalid
 *
 * @example
 * ```typescript
 * validateCronExpression('0 9 * * 1'); // Throws if invalid
 * ```
 */
export function validateCronExpression(expression: string): void {
	try {
		CronExpressionParser.parse(expression);
	} catch (error) {
		handleCronParseError(expression, error);
	}
}

function handleCronParseError(expression: string, error: unknown): never {
	/* istanbul ignore next -- @preserve cron-parser always throws Error objects */
	const errorMessage = error instanceof Error ? error.message : 'Unknown parsing error';
	throw new InvalidCronError(
		expression,
		`Invalid cron expression "${expression}": ${errorMessage}. ` +
			'Expected 5-field format: "minute hour day-of-month month day-of-week" or predefined expression (e.g. @daily). ' +
			'Example: "0 9 * * 1" (every Monday at 9am)',
	);
}
