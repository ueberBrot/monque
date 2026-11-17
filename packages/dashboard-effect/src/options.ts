import type { Effect } from "effect";

export interface DashboardEffectOptions<E = never, R = never> {
  /** Absolute host mount. Management is mounted independently. */
  readonly basePath: string;
  /** Management mount; the Dashboard appends /rpc. Evaluated in the host request. */
  readonly apiBaseUrl: string | Effect.Effect<string, E, R>;
  readonly pollingIntervalMs?: number;
}
