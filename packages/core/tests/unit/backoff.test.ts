import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { applyJitter, calculateBackoff, calculateBackoffDelay } from "@/shared";

describe("backoff", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  describe(applyJitter, () => {
    it.each([
      { delay: 4000, factor: 0 },
      { delay: 0, factor: 0.25 },
      { delay: 4000, factor: -0.1 },
    ])(
      "preserves $delay when jitter is disabled by factor $factor or zero delay",
      ({ delay, factor }) => {
        expect(applyJitter(delay, factor)).toBe(delay);
      },
    );

    it.each([
      { random: 0, expected: 7500 },
      { random: 0.5, expected: 10_000 },
      { random: 1 - Number.EPSILON, expected: 12_500 },
    ])(
      "spreads the delay across both bounds and midpoint with random=$random",
      ({ random, expected }) => {
        vi.spyOn(Math, "random").mockReturnValue(random);
        expect(applyJitter(10_000, 0.25)).toBe(expected);
      },
    );

    it("clamps negative jittered delays to zero", () => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      expect(applyJitter(100, 2)).toBe(0);
    });

    it.each([
      { random: 0, expected: 2500 },
      { random: 1 - Number.EPSILON, expected: 4166 },
    ])("rounds fractional delays with random=$random", ({ random, expected }) => {
      vi.spyOn(Math, "random").mockReturnValue(random);
      expect(applyJitter(3333, 0.25)).toBe(expected);
    });
  });
  describe(calculateBackoffDelay, () => {
    it("doubles the default one-second base for each failure when jitter is disabled", () => {
      expect(
        [0, 1, 2, 3, 4, 5, 10].map((failures) =>
          calculateBackoffDelay(failures, undefined, undefined, 0),
        ),
      ).toStrictEqual([1000, 2000, 4000, 8000, 16_000, 32_000, 1_024_000]);
    });

    it("supports custom and zero base intervals", () => {
      expect({
        calculateBackoffDelay3500Undefined0: calculateBackoffDelay(3, 500, undefined, 0),
        calculateBackoffDelay50Undefined0: calculateBackoffDelay(5, 0, undefined, 0),
      }).toStrictEqual({
        calculateBackoffDelay3500Undefined0: 4000,
        calculateBackoffDelay50Undefined0: 0,
      });
    });

    it("caps exponential delays at the configured maximum or 24 hours by default", () => {
      expect({
        calculateBackoffDelay1100060_0000: calculateBackoffDelay(1, 1000, 60_000, 0),
        calculateBackoffDelay10100060_0000: calculateBackoffDelay(10, 1000, 60_000, 0),
        calculateBackoffDelay201000Undefined0: calculateBackoffDelay(20, 1000, undefined, 0),
      }).toStrictEqual({
        calculateBackoffDelay1100060_0000: 2000,
        calculateBackoffDelay10100060_0000: 60_000,
        calculateBackoffDelay201000Undefined0: 86_400_000,
      });
    });

    it.each([
      { random: 0, expected: 6000 },
      { random: 1 - Number.EPSILON, expected: 10_000 },
    ])("applies 25 percent jitter by default with random=$random", ({ random, expected }) => {
      vi.spyOn(Math, "random").mockReturnValue(random);
      expect(calculateBackoffDelay(3)).toBe(expected);
    });

    it.each([
      { random: 0, expected: 45_000 },
      { random: 1 - Number.EPSILON, expected: 60_000 },
    ])(
      "jitters the capped delay without exceeding the maximum with random=$random",
      ({ random, expected }) => {
        vi.spyOn(Math, "random").mockReturnValue(random);
        expect(calculateBackoffDelay(20, 1000, 60_000, 0.25)).toBe(expected);
      },
    );
  });
  describe(calculateBackoff, () => {
    it("adds the delay to the current clock and forwards custom retry options", () => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      expect({
        calculateBackoff32000Undefined0GetTime: Object.is(
          calculateBackoff(3, 2000, undefined, 0).getTime(),
          Date.now() + 16_000,
        ),
        calculateBackoff3200010_00005GetTime: Object.is(
          calculateBackoff(3, 2000, 10_000, 0.5).getTime(),
          Date.now() + 5000,
        ),
      }).toStrictEqual({
        calculateBackoff32000Undefined0GetTime: true,
        calculateBackoff3200010_00005GetTime: true,
      });
      vi.advanceTimersByTime(1234);
      expect(calculateBackoff(3, 2000, 10_000, 0).getTime()).toBe(Date.now() + 10_000);
    });

    it("uses the default base interval, jitter and maximum", () => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      expect({
        calculateBackoff3GetTime: Object.is(calculateBackoff(3).getTime(), Date.now() + 6000),
        calculateBackoff20UndefinedUndefined0GetTime: Object.is(
          calculateBackoff(20, undefined, undefined, 0).getTime(),
          Date.now() + 86_400_000,
        ),
      }).toStrictEqual({
        calculateBackoff3GetTime: true,
        calculateBackoff20UndefinedUndefined0GetTime: true,
      });
    });
  });
});
