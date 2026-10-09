import { useCallback, useRef, useSyncExternalStore } from "react";

import { readManagementError } from "@/management-errors";

interface PollingQuery {
  state: {
    error: unknown;
    errorUpdateCount: number;
    dataUpdateCount: number;
  };
}
interface PollingFailure {
  errors: number;
  successes: number;
  count: number;
}
interface PollingState {
  failures: WeakMap<PollingQuery, PollingFailure>;
  jitter: number | null;
}
type PollingInterval = (query: PollingQuery) => number | false;
const subscribeToDocumentVisibility = (onStoreChange: () => void): (() => void) => {
  if (globalThis.document === undefined) {
    return () => {
      // Server-side rendering has no document event listener to remove.
    };
  }
  document.addEventListener("visibilitychange", onStoreChange);
  return () => {
    document.removeEventListener("visibilitychange", onStoreChange);
  };
};
const isDocumentVisible = (): boolean => {
  if (globalThis.document === undefined) {
    return true;
  }
  return document.visibilityState !== "hidden";
};
const useDocumentVisible = (): boolean =>
  useSyncExternalStore(subscribeToDocumentVisibility, isDocumentVisible, () => true);
const useDocumentVisiblePollingInterval = (
  pollingIntervalMs: number | undefined,
  cadence = 1,
): PollingInterval => {
  const documentVisible = useDocumentVisible();
  const pollingState = useRef<PollingState>({ failures: new WeakMap(), jitter: null });
  return useCallback(
    (query: PollingQuery) => {
      const state = pollingState.current;
      const jitter = state.jitter ?? 1 + Math.random() * 0.1;
      state.jitter = jitter;
      const { failures } = state;
      if (
        pollingIntervalMs === undefined ||
        pollingIntervalMs === 0 ||
        Number.isNaN(pollingIntervalMs) ||
        !documentVisible
      ) {
        return false;
      }
      const { status } = readManagementError(query.state.error);
      if (status === 401 || status === 403) {
        return false;
      }
      let failure = failures.get(query);
      if (failure && query.state.dataUpdateCount !== failure.successes) {
        failures.delete(query);
        failure = undefined;
      }
      if (
        query.state.error !== null &&
        (!failure || failure.errors !== query.state.errorUpdateCount)
      ) {
        failure = {
          errors: query.state.errorUpdateCount,
          successes: query.state.dataUpdateCount,
          count: (failure?.count ?? 0) + 1,
        };
        failures.set(query, failure);
      }
      const backoff = 2 ** Math.min(failure?.count ?? 0, 5);
      return Math.round(pollingIntervalMs * cadence * jitter * backoff);
    },
    [pollingIntervalMs, documentVisible, cadence],
  );
};
export { useDocumentVisible, useDocumentVisiblePollingInterval };
