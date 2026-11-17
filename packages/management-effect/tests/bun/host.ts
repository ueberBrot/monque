/* oxlint-disable eslint/max-classes-per-file -- Private host fixture keeps request services together. */
import { BunHttpServer } from "@effect/platform-bun";
import { Monque } from "@monque/core/effect";
import type { ManagementContract, NativeManagementOptions } from "@monque/management";
/* oxlint-disable eslint/max-classes-per-file, sonarjs/no-nested-functions, sonarjs/max-union-size -- Keep the disposable proof and its host service requirements in one module. */
import "@orpc/effect/extensions/effect";
import { ORPCError, createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
// @effect-diagnostics unstableApiUsage:off
/* oxlint-disable eslint/max-classes-per-file -- Host fixtures declare request-only identity and native operation dependencies. */
import type { ContractRouterClient } from "@orpc/contract";
import { Context, Effect, Exit, Scope } from "effect";
import { HttpServerRequest } from "effect/http";
import { MongoClient } from "mongodb";

import { createManagementEffectHandler } from "../../src/index";

export class Identity extends Context.Service<Identity, string>()("proof/Identity") {}

class Authorization extends Context.Service<
  Authorization,
  {
    check: Effect.Effect<void, ORPCError<"FORBIDDEN", undefined>, Identity | Scope.Scope>;
  }
>()("proof/Authorization") {}

class Scheduler extends Context.Service<Scheduler, Monque["effects"]>()("proof/Scheduler") {}

export interface HostOptions {
  port?: number;
  uri?: string;
  management?: Partial<NativeManagementOptions<string, Identity | Scope.Scope>>;
  onRelease?: () => void;
  beforeAuthorize?: (identity: string) => Effect.Effect<void>;
  onRunnerFinalize?: () => Effect.Effect<void>;
  onFinalize?: (identity: string) => Effect.Effect<void>;
}

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

  const dbClient = new MongoClient(options.uri ?? "mongodb://127.0.0.1:27017");

  const monque = new Monque(dbClient.db(`native-${crypto.randomUUID()}`), {
    schedulerInstanceId: "proof-686",
  });

  if (options.uri !== undefined) {
    await monque.initialize();
  }

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

    const handler = createManagementEffectHandler({
      ...options.management,
      monque: options.management?.monque ?? monque.effects,
      context: () => Effect.succeed(identity),
      authorize:
        options.management?.authorize ??
        (() =>
          Effect.gen(function* observedAuthorization() {
            const child = yield* Effect.currentSpan;
            traces.push({
              identity,
              host: hostSpan.spanId,
              parent: child.parent._tag === "Some" ? child.parent.value.spanId : undefined,
              trace: child.traceId,
              hostTrace: hostSpan.traceId,
            });
            yield* auth.check;

            return true;
          }).pipe(
            Effect.withSpan("orpc.operation"),
            Effect.ensuring(options.onRunnerFinalize?.() ?? Effect.void),
          )),
    });

    return yield* handler.pipe(Effect.provideContext(context));
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
    monque,
    events,
    traces,
    resumedIdentities,
    client: (identity: string): ContractRouterClient<ManagementContract> =>
      createORPCClient(
        new RPCLink({ origin: url, url: "/rpc", headers: { "x-identity": identity } }),
      ),
    close: async () => {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    },
  };
};
