import { OpenAPIHandler } from "@orpc/openapi/fetch";

import { createManagementRouter } from "../orpc/index.js";
import { createLimitedRequest } from "./body-limit.js";
import { isTrustedMutationRequest, parseTrustedOrigins } from "./csrf.js";
import type { ManagementOpenApiContext, ManagementOptions, ManagementSurface } from "./types.js";

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

  const trustedRequests = new WeakMap<object, boolean>();

  class ManagementOpenAPIHandler extends OpenAPIHandler<ManagementOpenApiContext<TContext>> {
    override async handle(
      request: Request,
      handleOptions: Partial<
        Parameters<OpenAPIHandler<ManagementOpenApiContext<TContext>>["handle"]>[1]
      > = {},
    ) {
      const trusted = isTrustedMutationRequest(
        {
          method: request.method,
          url: new URL(request.url),
          headers: Object.fromEntries(request.headers),
        },
        trustedOrigins,
      );

      const result = await super.handle(createLimitedRequest(request, maxBodySize), {
        ...handleOptions,
        context: async (standardRequest) => {
          trustedRequests.set(standardRequest, trusted);

          // oxlint-disable-next-line anti-slop/no-runtime-typeof -- oRPC permits either a context value or a context factory at this public seam.
          return await (typeof handleOptions?.context === "function"
            ? handleOptions.context(standardRequest)
            : (handleOptions?.context ?? {}));
        },
      });

      // oxlint-disable-next-line sonarjs/no-undefined-assignment -- Preserve the public unmatched result shape.
      return result.matched ? result : { matched: false as const, response: undefined };
    }
  }

  return {
    openApiHandler: new ManagementOpenAPIHandler(createManagementRouter(options), {
      customErrorResponseBodyEncoder: (error) => ({
        error:
          error.code === "INTERNAL_SERVER_ERROR" && error.message === "Internal Server Error"
            ? "Internal server error"
            : error.message,
      }),
      interceptors: [
        async (interceptorOptions) => {
          if (trustedRequests.get(interceptorOptions.request) === false) {
            return { status: 403, headers: {}, body: { error: "Untrusted request origin" } };
          }

          return await interceptorOptions.next();
        },
      ],
    }),
  };
};
