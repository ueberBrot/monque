// @effect-diagnostics unstableApiUsage:off
import { describe, expect, it } from "@effect/vitest";
import { Monque } from "@monque/core/effect";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { Context, Effect, Scope, Exit } from "effect";
import { MongoClient } from "mongodb";

import { createNativeManagementRouter } from "@/index";

class Viewer extends Context.Service<Viewer, string>()("tests/native-router/Viewer") {}

const authorize = Effect.fnUntraced(function* authorize(
  calls: string[],
  { context }: { context: string },
) {
  calls.push(`${yield* Viewer}:${context}`);
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      calls.push("released");
    }),
  );

  return true;
});

describe("native oRPC execution", () => {
  it.effect("uses host services once per HTTP operation and releases request hook resources", () =>
    Effect.gen(function* nativeRequest() {
      const client = new MongoClient("mongodb://127.0.0.1:27017");

      const scheduler = new Monque(client.db("native-router"), {
        schedulerInstanceId: "native-689",
      });

      const calls: string[] = [];
      const scope = yield* Scope.fork(yield* Effect.scope, "sequential");

      const router = createNativeManagementRouter({
        monque: scheduler.effects,
        authorize: (input: { context: string }) => authorize(calls, input),
      });

      const handler = new OpenAPIHandler(router);

      try {
        const result = yield* Effect.tryPromise(
          async () =>
            await handler.handle(new Request("https://host/api/v1/processing"), {
              context: {
                managementContext: "request",
                "effect/context": Context.make(Viewer, "operator").pipe(
                  Context.add(Scope.Scope, scope),
                ),
                "effect/wrap": (effect) =>
                  effect.pipe(
                    Effect.ensuring(
                      Effect.sync(() => {
                        calls.push("runner-finished");
                      }),
                    ),
                  ),
              },
            }),
        );

        expect(result.response?.status).toBe(200);
        const body: unknown = yield* Effect.promise(async () => await result.response?.json());
        expect(body).toStrictEqual({
          instanceId: "native-689",
          paused: false,
          globallyPaused: false,
        });
        expect(calls).toStrictEqual(["operator:request", "runner-finished"]);
      } finally {
        yield* Scope.close(scope, Exit.void);
        yield* scheduler.effects.dispose;
        yield* Effect.promise(async () => {
          await client.close();
        });
      }

      expect(calls).toStrictEqual(["operator:request", "runner-finished", "released"]);
    }),
  );
});
