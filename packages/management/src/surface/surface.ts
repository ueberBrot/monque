import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { ORPCError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";

import { createManagementRouter } from "../orpc/index.js";
import { createLimitedRequest } from "./body-limit.js";
import { isTrustedMutationRequest, parseTrustedOrigins } from "./csrf.js";
import type { ManagementOpenApiContext, ManagementOptions, ManagementSurface } from "./types.js";

/**
 * Create protected RPC and OpenAPI handlers over one Management router.
 *
 * The returned handler can be mounted by any framework that can provide a standard
 * `Request` object. Pass application request state through `managementContext` when
 * calling either handler’s `handle()` method.
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

  type Handler = RPCHandler<ManagementOpenApiContext<TContext>>;

  type HandleOptions = Partial<Parameters<Handler["handle"]>[1]>;

  const prepare = (request: Request, handleOptions: HandleOptions) => {
    const trusted = isTrustedMutationRequest(
      {
        method: request.method,
        url: new URL(request.url),
        headers: Object.fromEntries(request.headers),
      },
      trustedOrigins,
    );

    const preparedOptions: Parameters<Handler["handle"]>[1] = {
      ...handleOptions,
      context: async (standardRequest) => {
        trustedRequests.set(standardRequest, trusted);

        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- oRPC accepts a context value or factory.
        return await (typeof handleOptions.context === "function"
          ? handleOptions.context(standardRequest)
          : (handleOptions.context ?? {}));
      },
    };

    return { request: createLimitedRequest(request, maxBodySize), options: preparedOptions };
  };

  const protect = <T extends Handler>(handler: T): T => {
    const handle = handler.handle.bind(handler);
    // Preserve the official handler instance and its public optional-options contract.
    handler.handle = async (request: Request, handleOptions: HandleOptions = {}) => {
      const prepared = prepare(request, handleOptions);
      const result = await handle(prepared.request, prepared.options);

      // oxlint-disable-next-line sonarjs/no-undefined-assignment -- Preserve the public unmatched shape.
      return result.matched ? result : { matched: false as const, response: undefined };
    };

    return handler;
  };

  const router = createManagementRouter(options);

  return {
    rpcHandler: protect(
      new RPCHandler(router, {
        interceptors: [
          async (interceptorOptions) => {
            if (trustedRequests.get(interceptorOptions.request) === false) {
              throw new ORPCError("FORBIDDEN", { message: "Untrusted request origin" });
            }

            return await interceptorOptions.next();
          },
        ],
      }),
    ),
    openApiHandler: protect(
      new OpenAPIHandler(router, {
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
    ),
  };
};
