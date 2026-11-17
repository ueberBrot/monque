/* effect/http is intentionally public in this portable adapter; consumers pin Effect 4.1.4. */
// @effect-diagnostics apiStabilityLeak:off unstableApiUsage:off
import {
  createNativeManagementSurface,
  generateManagementOpenApiDocument,
} from "@monque/management";
import type { ManagementOpenApiContext } from "@monque/management";
import type { WithEffectContext } from "@orpc/effect";
import { Effect, Option } from "effect";
import type { Scope } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";

import { ManagementTransportError } from "./errors.js";
import { normalizePrefix } from "./options.js";
import type { ManagementEffectOptions } from "./options.js";

/**
 * Portable request effect. Provide host services per request and run in a request Scope.
 * The host owns the scheduler, runtime, authentication, listener and shutdown order.
 */
export const createManagementEffectHandler = function createManagementEffectHandler<
  TContext = unknown,
  R = never,
>(options: ManagementEffectOptions<TContext, R>) {
  const prefix = normalizePrefix(options.prefix);
  const surface = createNativeManagementSurface(options);

  const discovery =
    options.openApi === false ? undefined : (options.openApi?.path ?? "/openapi.json");

  return Effect.gen(function* managementRequest() {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const original = yield* HttpServerRequest.toWeb(request);
    const url = HttpServerRequest.toURL(request);

    if (Option.isNone(url)) {
      return yield* new ManagementTransportError({ cause: new Error("Invalid request URL") });
    }

    const effectiveUrl = url.value;
    const { pathname } = effectiveUrl;

    if (prefix !== undefined && pathname !== prefix && !pathname.startsWith(`${prefix}/`)) {
      return HttpServerResponse.empty({ status: 404 });
    }

    if (discovery !== undefined && pathname === `${prefix ?? ""}${discovery}`) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return HttpServerResponse.empty({ status: 405 });
      }

      const document = yield* Effect.tryPromise({
        try: generateManagementOpenApiDocument,
        catch: (cause) => new ManagementTransportError({ cause }),
      });

      const serverUrl = options.openApi === false ? undefined : options.openApi?.serverUrl;

      return HttpServerResponse.jsonUnsafe({
        ...document,
        servers: [{ url: serverUrl ?? prefix ?? "/" }],
      });
    }

    const managementContext =
      options.context === undefined ? undefined : yield* options.context(request);

    const context = yield* Effect.context<R | Scope.Scope>();
    const rpcPrefix = `${prefix ?? ""}/rpc` as const;
    const rpc = pathname === rpcPrefix || pathname.startsWith(`${rpcPrefix}/`);
    let pending: Promise<unknown> = Promise.resolve();

    return yield* Effect.tryPromise({
      try: async (signal) => {
        // Preserve host middleware URL/header changes even when toWeb returns its original Web source.
        const web = new Request(new Request(effectiveUrl.href, original), {
          headers: request.headers,
          signal: AbortSignal.any([original.signal, signal]),
        });

        const transportContext: ManagementOpenApiContext<TContext> & WithEffectContext<R> = {
          "effect/context": context,
        };

        if (managementContext !== undefined) {
          transportContext.managementContext = managementContext;
        }

        const result = (rpc ? surface.rpcHandler : surface.openApiHandler).handle(web, {
          prefix: rpc ? rpcPrefix : prefix,
          context: transportContext,
        });

        pending = result;
        const response = await result;

        return response.matched
          ? HttpServerResponse.fromWeb(response.response)
          : HttpServerResponse.empty({ status: 404 });
      },
      catch: (cause) => new ManagementTransportError({ cause }),
    }).pipe(
      Effect.ensuring(
        Effect.promise(async () => {
          await pending.catch(() => {
            /* Failure was delivered by tryPromise; join runner termination before request scope closure. */
          });
        }),
      ),
    );
  }).pipe(Effect.interruptible);
};
