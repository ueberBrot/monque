/* effect/http is intentionally public in this portable adapter; consumers pin Effect 4.1.4. */
// @effect-diagnostics apiStabilityLeak:off unstableApiUsage:off
import { HttpRouter } from "effect/http";

import { createManagementEffectHandler } from "./handler.js";
import { normalizePrefix } from "./options.js";
import type { ManagementEffectOptions } from "./options.js";

/** Mount both transports and discovery into the host's Effect HttpRouter. */
export const createManagementEffectRoutes = function createManagementEffectRoutes<
  TContext = unknown,
  R = never,
>(options: ManagementEffectOptions<TContext, R>) {
  const prefix = normalizePrefix(options.prefix);
  const handler = createManagementEffectHandler(options);

  return HttpRouter.use((router) => router.add("*", `${prefix ?? ""}/*` as const, handler));
};
