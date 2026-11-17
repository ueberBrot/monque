/* oxlint-disable eslint/max-classes-per-file, sonarjs/no-nested-functions, sonarjs/max-union-size -- Keep the disposable proof and its host service requirements in one module. */
import "@orpc/openapi/extensions/route";
import "@orpc/effect/extensions/effect";
import { BunHttpServer } from "@effect/platform-bun";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { WithEffectContext } from "@orpc/effect";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { os, ORPCError } from "@orpc/server";
import type { RouterClient } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { Context, Data, Effect, Exit, Scope } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { MongoClient } from "mongodb";

import { Monque } from "../../packages/core/src/effect";
import { ProcessingStateDtoSchema } from "../../packages/management/src/schemas/processing";

class Identity extends Context.Service<Identity, string>()("proof/Identity") {}

class Authorization extends Context.Service<
  Authorization,
  {
    check: Effect.Effect<void, ORPCError<"FORBIDDEN", undefined>, Identity | Scope.Scope>;
  }
>()("proof/Authorization") {}

class Scheduler extends Context.Service<Scheduler, Monque["effects"]>()("proof/Scheduler") {}

export interface HostOptions {
  port?: number;
  onRelease?: () => void;
  beforeAuthorize?: (identity: string) => Effect.Effect<void>;
  onRunnerFinalize?: () => Effect.Effect<void>;
  onFinalize?: (identity: string) => Effect.Effect<void>;
}

class TransportFailure extends Data.TaggedError("TransportFailure")<{ cause: unknown }> {}

export const startHost = async function startHost(options: HostOptions = {}) {
  const events: string[] = [];
  const resumedIdentities: string[] = [];

  const traces: {
    identity: string;
    host: string;
    parent: string | undefined;
    trace: string;
    hostTrace: string;
  }[] = [];

  const dbClient = new MongoClient("mongodb://127.0.0.1:27017");
  const monque = new Monque(dbClient.db("proof"), { schedulerInstanceId: "proof-686" });

  const procedure =
    os.$context<WithEffectContext<Identity | Authorization | Scheduler | Scope.Scope>>();

  const router = {
    processing: procedure
      .route({ method: "GET", path: "/api/v1/processing" })
      .errors({ FORBIDDEN: { message: "Denied" } })
      .output(ProcessingStateDtoSchema)
      .effect(function* processing() {
        yield* (yield* Authorization).check;

        return yield* (yield* Scheduler).getProcessingState();
      }),
  };

  const rpc = new RPCHandler(router);

  const http = new OpenAPIHandler(router, {
    customErrorResponseBodyEncoder: (error) => ({
      error: error.code === "INTERNAL_SERVER_ERROR" ? "Internal server error" : error.message,
    }),
  });

  const scope = Scope.makeUnsafe();

  const app = Effect.gen(function* app() {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const identity = request.headers["x-identity"] ?? "anonymous";
    const hostSpan = yield* Effect.currentSpan;

    const auth = Authorization.of({
      check: Effect.gen(function* check() {
        const who = yield* Identity;
        yield* Effect.addFinalizer(() =>
          Effect.gen(function* finalizeRequest() {
            if (options.onFinalize) {
              yield* options.onFinalize(who);
            }

            events.push(`finalized:${who}`);
          }),
        );
        events.push(`entered:${who}`);

        if (options.beforeAuthorize) {
          yield* options.beforeAuthorize(who);
        }

        resumedIdentities.push(yield* Identity);

        if (who === "denied") {
          return yield* Effect.fail(
            new ORPCError<"FORBIDDEN", undefined>("FORBIDDEN", { message: "Denied" }),
          );
        }

        return yield* Effect.void;
      }),
    });

    const context = (yield* Effect.context<Scope.Scope>()).pipe(
      Context.add(Identity, identity),
      Context.add(Authorization, auth),
      Context.add(Scheduler, monque.effects),
    );

    const wrap: NonNullable<WithEffectContext<never>["effect/wrap"]> = Effect.fn("orpc.operation")(
      function* observed<A>(effect: Effect.Effect<A, unknown>) {
        const child = yield* Effect.currentSpan;
        traces.push({
          identity,
          host: hostSpan.spanId,
          parent: child.parent._tag === "Some" ? child.parent.value.spanId : undefined,
          trace: child.traceId,
          hostTrace: hostSpan.traceId,
        });

        return yield* effect.pipe(Effect.ensuring(options.onRunnerFinalize?.() ?? Effect.void));
      },
    );

    const original = yield* HttpServerRequest.toWeb(request);
    let pending: Promise<unknown> = Promise.resolve();

    return yield* Effect.tryPromise({
      try: async (signal) => {
        const web = new Request(original, { signal: AbortSignal.any([original.signal, signal]) });
        const isRpc = new URL(web.url).pathname.startsWith("/rpc/");

        const response = isRpc
          ? rpc.handle(web, {
              prefix: "/rpc",
              context: { "effect/context": context, "effect/wrap": wrap },
            })
          : http.handle(web, { context: { "effect/context": context, "effect/wrap": wrap } });

        pending = response;

        return await response.then((result) =>
          result.matched
            ? HttpServerResponse.fromWeb(result.response)
            : HttpServerResponse.empty({ status: 404 }),
        );
      },
      catch: (cause) => new TransportFailure({ cause }),
    }).pipe(
      Effect.ensuring(
        Effect.promise(async () => {
          await pending.catch(() => {
            // Join completion; the transport failure was already delivered through tryPromise.
          });
        }),
      ),
    );
  }).pipe(Effect.withSpan("host.request"), Effect.interruptible);

  const url = await Effect.runPromise(
    Effect.gen(function* url() {
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          await monque.dispose();
          await dbClient.close();
          events.push("shared-released");
          options.onRelease?.();
        }),
      );

      const server = yield* BunHttpServer.make({
        hostname: "127.0.0.1",
        port: options.port ?? 0,
        gracefulShutdownTimeout: 100,
      });

      yield* server.serve(app);

      if (server.address._tag === "UnixPathAddress") {
        throw new Error("Expected TCP");
      }

      return `http://127.0.0.1:${server.address.port}`;
    }).pipe(Scope.provide(scope)),
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Preserve arbitrary startup rejection while releasing the host scope.
  ).catch(async (error: unknown) => {
    await Effect.runPromise(Scope.close(scope, Exit.fail(error)));
    throw error;
  });

  return {
    url,
    events,
    traces,
    resumedIdentities,
    client: (identity: string): RouterClient<typeof router> =>
      createORPCClient(
        new RPCLink({ origin: url, url: "/rpc", headers: { "x-identity": identity } }),
      ),
    close: async () => {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    },
  };
};
