import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { ORPCError } from "@orpc/server";

import { createManagementRouter } from "../orpc/index.js";
import { createLimitedRequest } from "./body-limit.js";
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
export const createManagementSurface = function createManagementSurface<TContext = unknown>(
  options: ManagementOptions<TContext>,
): ManagementSurface<TContext> {
  const maxBodySize = options.maxBodySize ?? 64 * 1024;
  if (!Number.isSafeInteger(maxBodySize) || maxBodySize < 0) {
    throw new TypeError("maxBodySize must be a nonnegative safe integer");
  }
  const trustedOrigins = parseTrustedOrigins(options.trustedOrigins ?? []);

  return {
    openApiHandler: new OpenAPIHandler(createManagementRouter(options), {
      adapterInterceptors: [
        async (interceptorOptions) =>
          await interceptorOptions.next({
            ...interceptorOptions,
            request: createLimitedRequest(interceptorOptions.request, maxBodySize),
          }),
      ],
      customErrorResponseBodyEncoder: (error) => ({ error: error.message }),
      interceptors: [
        async (interceptorOptions) => {
          if (!isTrustedMutationRequest(interceptorOptions.request, trustedOrigins)) {
            return await interceptorOptions.next({
              ...interceptorOptions,
              request: {
                ...interceptorOptions.request,
                body: async () =>
                  await Promise.reject(
                    new ORPCError("FORBIDDEN", { message: "Untrusted request origin" }),
                  ),
              },
            });
          }

          return await interceptorOptions.next();
        },
      ],
    }),
  };
};
