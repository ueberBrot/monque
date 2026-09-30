import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { ORPCError } from "@orpc/server";

import { createManagementRouter } from "../orpc/index.js";
import { isTrustedMutationRequest, parseTrustedOrigins } from "./csrf.js";
import type { ManagementOptions, ManagementSurface } from "./types.js";

/**
 * Create a framework-neutral OpenAPI handler for the Monque management API.
 *
 * The returned handler can be mounted by any framework that can provide a standard
 * `Request` object. Pass application request state through `managementContext` when
 * calling `openApiHandler.handle()`.
 *
 * @example
 * ```typescript
 * const management = createManagementSurface({
 * 	monque,
 * 	readOnly: true,
 * 	authorize: ({ action }) => action === 'read',
 * });
 *
 * await management.openApiHandler.handle(request, {
 * 	context: { managementContext: { userId: 'operator-1' } },
 * });
 * ```
 */
export function createManagementSurface<TContext = unknown>(
  options: ManagementOptions<TContext>,
): ManagementSurface<TContext> {
  const trustedOrigins = parseTrustedOrigins(options.trustedOrigins ?? []);

  return {
    openApiHandler: new OpenAPIHandler(createManagementRouter(options), {
      customErrorResponseBodyEncoder: (error) => ({ error: error.message }),
      interceptors: [
        (options) => {
          if (!isTrustedMutationRequest(options.request, trustedOrigins)) {
            return options.next({
              ...options,
              request: {
                ...options.request,
                body: async () => {
                  throw new ORPCError("FORBIDDEN", { message: "Untrusted request origin" });
                },
              },
            });
          }

          return options.next();
        },
      ],
    }),
  };
}
