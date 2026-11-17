/* oxlint-disable eslint/max-classes-per-file, sonarjs/no-nested-functions, sonarjs/max-union-size -- The host fixture owns its request services and lifecycle hooks. */
// @effect-diagnostics unstableApiUsage:off
import { createServer } from "node:http";
import { NodeHttpServer } from "@effect/platform-node";
import { Monque } from "@monque/core/effect";
import type { ManagementContract, NativeManagementOptions } from "@monque/management";
import { ORPCError, createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterContractClient } from "@orpc/contract";
import { Context, Effect, Exit, Scope } from "effect";
import { HttpServerRequest } from "effect/http";
import { MongoClient } from "mongodb";

import { createManagementEffectHandler } from "../../src/index";

export class Identity extends Context.Service<Identity, string>()(
  "tests/management-effect/Identity",
) {}

class Authorization extends Context.Service<
  Authorization,
  {
    check: Effect.Effect<void, ORPCError<"FORBIDDEN", undefined>, Identity | Scope.Scope>;
  }
>()("tests/management-effect/Authorization") {}

class Scheduler extends Context.Service<Scheduler, Monque["effects"]>()(
  "tests/management-effect/Scheduler",
) {}

export interface HostOptions {
  port?: number;
  uri?: string;
  management?: Partial<NativeManagementOptions<string, Identity | Scope.Scope>>;
  onRelease?: () => void;
  beforeAuthorize?: (identity: string) => Effect.Effect<void>;
  onRunnerFinalize?: () => Effect.Effect<void>;
  onFinalize?: (identity: string) => Effect.Effect<void>;
  onFinalized?: (identity: string) => Effect.Effect<void>;
}

export const startHost = Effect.fnUntraced(function* startHost(options: HostOptions = {}) {
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

  const scope = yield* Scope.fork(yield* Effect.scope, "sequential");

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

            if (options.onFinalized) {
              yield* options.onFinalized(who);
            }
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

  const url = yield* Effect.gen(function* url() {
    yield* Effect.addFinalizer(() =>
      monque.effects.dispose.pipe(
        Effect.orDie,
        Effect.andThen(
          Effect.promise(async () => {
            await dbClient.close();
            events.push("shared-released");
            options.onRelease?.();
          }),
        ),
      ),
    );

    if (options.uri !== undefined) {
      yield* Effect.tryPromise(async () => {
        await monque.initialize();
      });
    }

    const server = yield* NodeHttpServer.make(() => createServer(), {
      host: "127.0.0.1",
      port: options.port ?? 0,
      gracefulShutdownTimeout: 100,
    });

    yield* server.serve(app);

    if (server.address._tag === "UnixPathAddress") {
      throw new Error("Expected TCP");
    }

    return `http://127.0.0.1:${server.address.port}`;
  }).pipe(
    Scope.provide(scope),
    Effect.onError((cause) => Scope.close(scope, Exit.failCause(cause))),
  );

  return {
    url,
    monque,
    events,
    traces,
    resumedIdentities,
    client: (identity: string): RouterContractClient<ManagementContract> =>
      createORPCClient(
        new RPCLink({ origin: url, url: "/rpc", headers: { "x-identity": identity } }),
      ),
    close: Scope.close(scope, Exit.void),
  };
});

export type ManagementTestHost = Effect.Success<ReturnType<typeof startHost>>;
