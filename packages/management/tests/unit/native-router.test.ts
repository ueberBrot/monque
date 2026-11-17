import { Monque } from "@monque/core/effect";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { Context, Effect, Scope, Exit } from "effect";
import { MongoClient } from "mongodb";
import { describe, expect, it } from "vite-plus/test";

import { createNativeManagementRouter } from "@/index";

class Viewer extends Context.Service<Viewer, string>()("tests/native-router/Viewer") {}

describe("native oRPC execution", () => {
  it("uses host services once per HTTP operation and releases request hook resources", async () => {
    const client = new MongoClient("mongodb://127.0.0.1:27017");
    const scheduler = new Monque(client.db("native-router"), { schedulerInstanceId: "native-689" });
    scheduler.getJobsWithCursor = () => {
      throw new Error("Promise facade used");
    };

    const calls: string[] = [];

    const router = createNativeManagementRouter({
      monque: scheduler.effects,
      authorize: ({ context }: { context: string }) =>
        Effect.gen(function* authorize() {
          calls.push(`${yield* Viewer}:${context}`);
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              calls.push("released");
            }),
          );

          return true;
        }),
    });

    const handler = new OpenAPIHandler(router);
    const scope = Scope.makeUnsafe();

    try {
      const result = await handler.handle(new Request("https://host/api/v1/processing"), {
        context: {
          managementContext: "request",
          "effect/context": Context.make(Viewer, "operator").pipe(Context.add(Scope.Scope, scope)),
          "effect/wrap": (effect) =>
            effect.pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  calls.push("runner-finished");
                }),
              ),
            ),
        },
      });

      expect(result.response?.status).toBe(200);
      await expect(result.response?.json()).resolves.toStrictEqual({
        instanceId: "native-689",
        paused: false,
        globallyPaused: false,
      });
      expect(calls).toStrictEqual(["operator:request", "runner-finished"]);
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void));
      await scheduler.dispose();
      await client.close();
    }

    expect(calls).toStrictEqual(["operator:request", "runner-finished", "released"]);
  });
});
