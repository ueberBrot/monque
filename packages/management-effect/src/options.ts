/* effect/http is intentionally public in this portable adapter; consumers pin Effect 4.1.4. */
// @effect-diagnostics apiStabilityLeak:off unstableApiUsage:off
import type { NativeManagementOptions } from "@monque/management";
import type { Effect } from "effect";
import type { HttpServerRequest } from "effect/http";

export interface ManagementEffectOptions<
  TContext = unknown,
  R = never,
> extends NativeManagementOptions<TContext, R> {
  /** Absolute mount path, without a trailing slash. Defaults to the root. */
  prefix?: `/${string}`;
  /** Host authentication and identity remain outside this adapter. */
  context?: (request: HttpServerRequest.HttpServerRequest) => Effect.Effect<TContext, unknown, R>;
  /** Disable discovery or customize its relative path and advertised server URL. */
  openApi?: false | { path?: `/${string}`; serverUrl?: string };
}

export const normalizePrefix = (prefix: `/${string}` | undefined): `/${string}` | undefined => {
  let normalized = prefix;

  while (normalized?.endsWith("/") === true) {
    // SAFETY: Removing trailing slashes preserves a leading slash until the root becomes empty.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Input already requires a leading slash.
    normalized = normalized.slice(0, -1) as `/${string}`;
  }

  if (normalized === undefined || normalized.length === 0) {
    return undefined;
  }

  return normalized;
};
