import type { WithEffectContext } from "@orpc/effect";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import type { Router } from "@orpc/server";
import { ORPCError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import type {
  FriendlyStandardHandlerHandleOptions,
  StandardHandlerInterceptorOptions,
} from "@orpc/server/standard";

import type { NativeManagementOptions } from "../native.js";
import { createManagementRouter } from "../orpc/index.js";
import { createNativeManagementRouter } from "../orpc/router.js";
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
  return createProtectedSurface(createManagementRouter(options), options);
};

/** Shared native router with the same request protections and protocol encoders. */
export const createNativeManagementSurface = function createNativeManagementSurface<
  TContext = unknown,
  R = never,
>(options: NativeManagementOptions<TContext, R>) {
  return createProtectedSurface<ManagementOpenApiContext<TContext> & WithEffectContext<R>>(
    createNativeManagementRouter(options),
    options,
  );
};

const createProtectedSurface = function createProtectedSurface<C extends Record<string, unknown>>(
  router: Router<C>,
  options: { maxBodySize?: number; trustedOrigins?: readonly string[] },
) {
  const maxBodySize = options.maxBodySize ?? 64 * 1024;

  if (!Number.isSafeInteger(maxBodySize) || maxBodySize < 0) {
    throw new TypeError("maxBodySize must be a nonnegative safe integer");
  }

  const trustedOrigins = parseTrustedOrigins(options.trustedOrigins ?? []);

  const trustedRequests = new WeakMap<object, boolean>();

  type Handler = RPCHandler<C>;

  type HandleOptions = Partial<FriendlyStandardHandlerHandleOptions<C>>;

  const prepare = (request: Request, handleOptions: HandleOptions) => {
    const trusted = isTrustedMutationRequest(
      {
        method: request.method,
        url: new URL(request.url),
        headers: Object.fromEntries(request.headers),
      },
      trustedOrigins,
    );

    // SAFETY: The context factory below is always present, satisfying the official required/optional context union.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Normalize a conditional generic options type.
    const preparedOptions = {
      ...handleOptions,
      context: async (standardRequest: StandardHandlerInterceptorOptions<C>["request"]) => {
        trustedRequests.set(standardRequest, trusted);

        // SAFETY: An absent context is supported by the compatibility factory; native callers must supply effect/context.
        /* oxlint-disable typescript/no-unsafe-type-assertion, anti-slop/no-runtime-typeof -- Official context value-or-factory and compatible empty context. */
        return await (typeof handleOptions.context === "function"
          ? handleOptions.context(standardRequest)
          : (handleOptions.context ?? ({} as C)));
        /* oxlint-enable typescript/no-unsafe-type-assertion, anti-slop/no-runtime-typeof */
      },
    } as FriendlyStandardHandlerHandleOptions<C>;

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
