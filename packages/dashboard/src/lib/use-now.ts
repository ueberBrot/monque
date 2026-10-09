import { useCallback, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let interval: ReturnType<typeof setInterval> | undefined;
const updateClocks = (): void => {
  if (document.visibilityState !== "hidden") {
    for (const listener of listeners) {
      listener();
    }
  }
};
const subscribeToClock = (onChange: () => void): (() => void) => {
  listeners.add(onChange);
  if (listeners.size === 1) {
    interval = setInterval(updateClocks, 1000);
    document.addEventListener("visibilitychange", updateClocks);
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) {
      clearInterval(interval);
      interval = undefined;
      document.removeEventListener("visibilitychange", updateClocks);
    }
  };
};
const getClockSnapshot = (reference?: number): number => {
  // A stable snapshot within each displayed second, refreshed on render as well as timer ticks.
  const now = Date.now();
  if (reference !== undefined && Math.abs(now - reference) >= 60_000) {
    // Round elapsed minutes, not wall-clock minutes, so the label never jumps backwards.
    return reference + Math.round((now - reference) / 60_000) * 60_000;
  }
  return Math.floor(now / 1000) * 1000;
};
/** Relative labels tick locally without refetching jobs. */
const useNow = (reference?: number): Date => {
  const snapshot = useCallback(() => getClockSnapshot(reference), [reference]);
  const timestamp = useSyncExternalStore(subscribeToClock, snapshot, () => 0);
  return new Date(timestamp);
};
export { useNow };
