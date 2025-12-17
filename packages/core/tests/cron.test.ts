import { describe, expect, it } from 'vitest';
import { InvalidCronError } from '../src/errors.js';
import { getNextCronDate, validateCronExpression } from '../src/utils/cron.js';

// Test fixtures - shared reference dates
const TEST_DATE_MID_MORNING = new Date('2025-01-01T10:30:00.000Z');
const TEST_DATE_EARLY_MORNING = new Date('2025-01-01T08:00:00.000Z');

describe('cron', () => {
	describe('getNextCronDate', () => {
		it('should parse "* * * * *" (every minute)', () => {
			const now = new Date();
			const result = getNextCronDate('* * * * *', now);
			expect(result).toBeInstanceOf(Date);
			// Should be within the next minute
			expect(result.getTime()).toBeGreaterThan(now.getTime());
			expect(result.getTime() - now.getTime()).toBeLessThanOrEqual(60000);
		});

		it('should parse "0 * * * *" (every hour at minute 0)', () => {
			const result = getNextCronDate('0 * * * *', TEST_DATE_MID_MORNING);
			// Next run should be at minute 0
			expect(result.getMinutes()).toBe(0);
			expect(result.getTime()).toBeGreaterThan(TEST_DATE_MID_MORNING.getTime());
		});

		it('should parse "0 0 * * *" (every day at midnight)', () => {
			const result = getNextCronDate('0 0 * * *', TEST_DATE_MID_MORNING);
			// Next run should be at 00:00
			expect(result.getHours()).toBe(0);
			expect(result.getMinutes()).toBe(0);
			expect(result.getTime()).toBeGreaterThan(TEST_DATE_MID_MORNING.getTime());
		});

		it('should parse "30 9 * * 1" (every Monday at 9:30am)', () => {
			// Jan 1, 2025 is a Wednesday
			const result = getNextCronDate('30 9 * * 1', TEST_DATE_MID_MORNING);
			// Result should be on a Monday
			expect(result.getDay()).toBe(1); // Monday
			expect(result.getMinutes()).toBe(30);
			expect(result.getTime()).toBeGreaterThan(TEST_DATE_MID_MORNING.getTime());
		});

		it('should parse "0 12 1 * *" (first day of every month at noon)', () => {
			const result = getNextCronDate('0 12 1 * *', TEST_DATE_EARLY_MORNING);
			// Next run should be on the 1st of the month at noon
			expect(result.getDate()).toBe(1);
			expect(result.getHours()).toBe(12);
			expect(result.getMinutes()).toBe(0);
		});

		it('should accept a custom reference date', () => {
			const referenceDate = new Date('2025-06-15T08:00:00.000Z');
			const result = getNextCronDate('0 9 * * *', referenceDate);
			// Next 9am after June 15 8am
			expect(result.getHours()).toBe(9);
			expect(result.getMinutes()).toBe(0);
			expect(result.getTime()).toBeGreaterThan(referenceDate.getTime());
		});

		it('should throw InvalidCronError for invalid expression', () => {
			expect(() => getNextCronDate('invalid')).toThrow(InvalidCronError);
		});

		it('should throw InvalidCronError with expression property', () => {
			try {
				getNextCronDate('not a cron');
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(InvalidCronError);
				expect((error as InvalidCronError).expression).toBe('not a cron');
			}
		});

		it('should include helpful error message with format example', () => {
			try {
				getNextCronDate('bad');
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(InvalidCronError);
				const message = (error as InvalidCronError).message;
				expect(message).toContain('Invalid cron expression');
				expect(message).toContain('"bad"');
				expect(message).toContain('minute hour day-of-month month day-of-week');
				expect(message).toContain('Example:');
			}
		});

		it('should handle expressions with ranges', () => {
			const result = getNextCronDate('0 9-17 * * *', TEST_DATE_EARLY_MORNING); // 9am to 5pm
			// Next run should be between 9am and 5pm
			expect(result.getHours()).toBeGreaterThanOrEqual(9);
			expect(result.getHours()).toBeLessThanOrEqual(17);
			expect(result.getMinutes()).toBe(0);
		});

		it('should handle expressions with steps', () => {
			const result = getNextCronDate('*/15 * * * *', TEST_DATE_MID_MORNING); // Every 15 minutes
			// Next 15-minute mark
			expect(result.getMinutes() % 15).toBe(0);
			expect(result.getTime()).toBeGreaterThan(TEST_DATE_MID_MORNING.getTime());
		});

		it('should handle expressions with lists', () => {
			const result = getNextCronDate('0 9,12,18 * * *', TEST_DATE_MID_MORNING); // 9am, 12pm, 6pm
			// Next should be at one of those hours
			expect([9, 12, 18]).toContain(result.getHours());
			expect(result.getMinutes()).toBe(0);
			expect(result.getTime()).toBeGreaterThan(TEST_DATE_MID_MORNING.getTime());
		});
	});

	describe('validateCronExpression', () => {
		it('should return true for valid expressions', () => {
			expect(validateCronExpression('* * * * *')).toBe(true);
			expect(validateCronExpression('0 0 * * *')).toBe(true);
			expect(validateCronExpression('30 9 1 * 1')).toBe(true);
			expect(validateCronExpression('*/5 * * * *')).toBe(true);
			expect(validateCronExpression('0 9-17 * * 1-5')).toBe(true);
		});

		it('should throw InvalidCronError for invalid expressions', () => {
			expect(() => validateCronExpression('invalid')).toThrow(InvalidCronError);
			expect(() => validateCronExpression('60 * * * *')).toThrow(InvalidCronError); // Invalid minute
			expect(() => validateCronExpression('* 25 * * *')).toThrow(InvalidCronError); // Invalid hour
		});

		it('should throw InvalidCronError with expression property', () => {
			try {
				validateCronExpression('wrong');
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(InvalidCronError);
				expect((error as InvalidCronError).expression).toBe('wrong');
			}
		});

		it('should include helpful error message', () => {
			try {
				validateCronExpression('x x x x x');
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(InvalidCronError);
				const message = (error as InvalidCronError).message;
				expect(message).toContain('Invalid cron expression');
				expect(message).toContain('Example:');
			}
		});
	});
});
