import type { Clock, Effect } from "effect";

/** Override wall time while retaining the source clock's elapsed time and sleep behavior. */
export const clockWithWallTime = (
  clock: Clock.Clock,
  currentTimeMillis: Effect.Effect<number>,
  currentTimeMillisUnsafe: () => number,
): Clock.Clock => ({
  currentTimeMillis,
  currentTimeMillisUnsafe,
  currentTimeNanos: clock.currentTimeNanos,
  currentTimeNanosUnsafe: () => clock.currentTimeNanosUnsafe(),
  monotonicTimeNanos: clock.monotonicTimeNanos,
  monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
  sleep: (duration) => clock.sleep(duration),
});
