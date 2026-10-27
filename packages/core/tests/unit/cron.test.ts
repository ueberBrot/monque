import { describe, expect, it } from "vite-plus/test";

import { getNextCronDate, InvalidCronError, validateCronExpression } from "@/shared";
// Test fixtures - shared reference dates
const TEST_DATE_MID_MORNING = new Date("2025-01-01T10:30:00.000Z");
const TEST_DATE_EARLY_MORNING = new Date("2025-01-01T08:00:00.000Z");
const cronFailure = (operation: () => void): InvalidCronError => {
  try {
    operation();
  } catch (error) {
    if (error instanceof InvalidCronError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected an InvalidCronError");
};

describe("cron", () => {
  describe(getNextCronDate, () => {
    it('should parse "* * * * *" (every minute)', () => {
      const now = new Date();
      const result = getNextCronDate("* * * * *", now);
      expect(result).toBeInstanceOf(Date);
      // Should be within the next minute
      expect(result.getTime()).toBeGreaterThan(now.getTime());
      expect(result.getTime() - now.getTime()).toBeLessThanOrEqual(60_000);
    });

    it('should parse "0 * * * *" (every hour at minute 0)', () => {
      const result = getNextCronDate("0 * * * *", TEST_DATE_MID_MORNING);
      // Next run should be at minute 0
      expect(result.getMinutes()).toBe(0);
      expect(result.getTime()).toBeGreaterThan(TEST_DATE_MID_MORNING.getTime());
    });

    it('should parse "0 0 * * *" (every day at midnight)', () => {
      const result = getNextCronDate("0 0 * * *", TEST_DATE_MID_MORNING);
      // Next run should be at 00:00
      expect({
        resultGetHours: result.getHours(),
        resultGetMinutes: result.getMinutes(),
      }).toStrictEqual({
        resultGetHours: 0,
        resultGetMinutes: 0,
      });
      expect(result.getTime()).toBeGreaterThan(TEST_DATE_MID_MORNING.getTime());
    });

    it("should parse predefined expressions like @daily", () => {
      const result = getNextCronDate("@daily", TEST_DATE_MID_MORNING);
      // Next run should be at 00:00
      expect({
        resultGetHours: result.getHours(),
        resultGetMinutes: result.getMinutes(),
      }).toStrictEqual({
        resultGetHours: 0,
        resultGetMinutes: 0,
      });
      expect(result.getTime()).toBeGreaterThan(TEST_DATE_MID_MORNING.getTime());
    });

    it('should parse "30 9 * * 1" (every Monday at 9:30am)', () => {
      // Jan 1, 2025 is a Wednesday
      const result = getNextCronDate("30 9 * * 1", TEST_DATE_MID_MORNING);
      // Result should be on a Monday
      // Monday
      expect({
        resultGetDay: result.getDay(),
        resultGetMinutes: result.getMinutes(),
        resultGetHours: result.getHours(),
      }).toStrictEqual({
        resultGetDay: 1,
        resultGetMinutes: 30,
        resultGetHours: 9,
      });
      expect(result.getTime()).toBeGreaterThan(TEST_DATE_MID_MORNING.getTime());
    });

    it('should parse "0 12 1 * *" (first day of every month at noon)', () => {
      const result = getNextCronDate("0 12 1 * *", TEST_DATE_EARLY_MORNING);
      // Next run should be on the 1st of the month at noon
      expect({
        resultGetDate: result.getDate(),
        resultGetHours: result.getHours(),
        resultGetMinutes: result.getMinutes(),
      }).toStrictEqual({
        resultGetDate: 1,
        resultGetHours: 12,
        resultGetMinutes: 0,
      });
    });

    it("should accept a custom reference date", () => {
      const referenceDate = new Date("2025-06-15T08:00:00.000Z");
      const result = getNextCronDate("0 9 * * *", referenceDate);
      // Next 9am after June 15 8am
      expect({
        resultGetHours: result.getHours(),
        resultGetMinutes: result.getMinutes(),
      }).toStrictEqual({
        resultGetHours: 9,
        resultGetMinutes: 0,
      });
      expect(result.getTime()).toBeGreaterThan(referenceDate.getTime());
    });

    it("should throw InvalidCronError for invalid expression", () => {
      expect(() => getNextCronDate("invalid")).toThrow(InvalidCronError);
    });

    it("should throw InvalidCronError with expression property", () => {
      const error = cronFailure(() => {
        getNextCronDate("not a cron");
      });
      expect(error).toBeInstanceOf(InvalidCronError);
      expect(error.expression).toBe("not a cron");
    });

    it("should include helpful error message with format example", () => {
      const error = cronFailure(() => {
        getNextCronDate("bad");
      });
      expect(error).toBeInstanceOf(InvalidCronError);
      const { message } = error;
      const expectedFragments = [
        "Invalid cron expression",
        '"bad"',
        "minute hour day-of-month month day-of-week",
        "predefined expression",
        "Example:",
      ];
      expect(expectedFragments.filter((fragment) => !message.includes(fragment))).toStrictEqual([]);
    });

    it("should handle expressions with ranges", () => {
      // 9am to 5pm
      const result = getNextCronDate("0 9-17 * * *", TEST_DATE_EARLY_MORNING);
      // Next run should be between 9am and 5pm
      expect(result.getHours()).toBeGreaterThanOrEqual(9);
      expect(result.getHours()).toBeLessThanOrEqual(17);
      expect(result.getMinutes()).toBe(0);
    });

    it("should handle expressions with steps", () => {
      // Every 15 minutes
      const result = getNextCronDate("*/15 * * * *", TEST_DATE_MID_MORNING);
      // Next 15-minute mark
      expect(result.getMinutes() % 15).toBe(0);
      expect(result.getTime()).toBeGreaterThan(TEST_DATE_MID_MORNING.getTime());
    });

    it("should handle expressions with lists", () => {
      // 9am, 12pm, 6pm
      const result = getNextCronDate("0 9,12,18 * * *", TEST_DATE_MID_MORNING);
      // Next should be at one of those hours
      expect([9, 12, 18]).toContain(result.getHours());
      expect(result.getMinutes()).toBe(0);
      expect(result.getTime()).toBeGreaterThan(TEST_DATE_MID_MORNING.getTime());
    });
  });
  describe(validateCronExpression, () => {
    it("should not throw for valid expressions", () => {
      expect(() => {
        validateCronExpression("* * * * *");
      }).not.toThrow();
      expect(() => {
        validateCronExpression("0 0 * * *");
      }).not.toThrow();
      expect(() => {
        validateCronExpression("30 9 1 * 1");
      }).not.toThrow();
      expect(() => {
        validateCronExpression("*/5 * * * *");
      }).not.toThrow();
      expect(() => {
        validateCronExpression("0 9-17 * * 1-5");
      }).not.toThrow();
    });

    it("should throw InvalidCronError for invalid expressions", () => {
      expect(() => {
        validateCronExpression("invalid");
      }).toThrow(InvalidCronError);
      expect(() => {
        validateCronExpression("60 * * * *");
        // Invalid minute
      }).toThrow(InvalidCronError);
      expect(() => {
        validateCronExpression("* 25 * * *");
        // Invalid hour
      }).toThrow(InvalidCronError);
    });

    it("should throw InvalidCronError with expression property", () => {
      const error = cronFailure(() => {
        validateCronExpression("wrong");
      });
      expect(error).toBeInstanceOf(InvalidCronError);
      expect(error.expression).toBe("wrong");
    });

    it("should include helpful error message", () => {
      const error = cronFailure(() => {
        validateCronExpression("x x x x x");
      });
      expect(error).toBeInstanceOf(InvalidCronError);
      const { message } = error;
      expect(message).toContain("Invalid cron expression");
      expect(message).toContain("Example:");
    });
  });
});
