import { Monque } from "@monque/core/effect";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { Context, Effect, Scope, Exit } from "effect";
import { MongoClient } from "mongodb";
import { describe, expect, it } from "vite-plus/test";

import { createNativeManagementRouter } from "@/index";
import { createManagementJob } from "@tests/unit/management-test-utils";

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
        },
      });

      expect(result.response?.status).toBe(200);
      await expect(result.response?.json()).resolves.toStrictEqual({
        instanceId: "native-689",
        paused: false,
        globallyPaused: false,
      });
      expect(calls).toStrictEqual(["operator:request"]);
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void));
      await scheduler.dispose();
      await client.close();
    }

    expect(calls).toStrictEqual(["operator:request", "released"]);
  });

  it("interrupts pending native authorization when the HTTP request aborts and joins runner cleanup", async () => {
    const client = new MongoClient("mongodb://127.0.0.1:27017");
    const scheduler = new Monque(client.db("native-abort"));
    const entered: PromiseWithResolvers<void> = Promise.withResolvers();
    let finalized = false;

    const router = createNativeManagementRouter({
      monque: scheduler.effects,
      authorize: () =>
        Effect.sync(() => {
          entered.resolve();
        }).pipe(Effect.andThen(Effect.never)),
    });

    const handler = new OpenAPIHandler(router);
    const controller = new AbortController();

    try {
      const pending = handler.handle(
        new Request("https://host/api/v1/processing", { signal: controller.signal }),
        {
          context: {
            managementContext: {},
            "effect/context": Context.empty(),
            "effect/wrap": (effect) =>
              effect.pipe(
                Effect.ensuring(
                  Effect.sync(() => {
                    finalized = true;
                  }),
                ),
              ),
          },
        },
      );

      await entered.promise;
      controller.abort();
      await pending;
      expect(finalized).toBe(true);
    } finally {
      await scheduler.dispose();
      await client.close();
    }
  });

  it("keeps service-backed payload redaction isolated between concurrent HTTP requests", async () => {
    const client = new MongoClient("mongodb://127.0.0.1:27017");
    const scheduler = new Monque(client.db("native-payload"));
    const job = createManagementJob();

    const handler = new OpenAPIHandler(
      createNativeManagementRouter({
        monque: { ...scheduler.effects, getJob: () => Effect.succeed(job) },
        authorize: ({ context }: { context: string }) =>
          Effect.gen(function* authorize() {
            yield* Effect.yieldNow;

            return (yield* Viewer) === context;
          }),
        serializePayload: () => Effect.die("per-name serializer must take precedence"),
        serializePayloadByJobName: {
          [job.name]: () =>
            Effect.gen(function* redact() {
              const viewer = yield* Viewer;
              yield* Effect.yieldNow;

              return { viewer, resumed: yield* Viewer };
            }),
        },
      }),
    );

    try {
      const results = await Promise.all(
        ["alice", "bob"].map(async (viewer) => {
          const result = await handler.handle(
            new Request(`https://host/api/v1/jobs/${job._id.toHexString()}`),
            {
              context: {
                managementContext: viewer,
                "effect/context": Context.make(Viewer, viewer),
              },
            },
          );

          expect(result.response?.status).toBe(200);

          return await result.response?.json();
        }),
      );

      expect(results).toMatchObject([
        { payload: { viewer: "alice", resumed: "alice" } },
        { payload: { viewer: "bob", resumed: "bob" } },
      ]);
    } finally {
      await scheduler.dispose();
      await client.close();
    }
  });
});
