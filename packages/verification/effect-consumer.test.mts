// @effect-diagnostics unstableApiUsage:off
import { createRequire } from "node:module";
import { assert, it, describe } from "@effect/vitest";
import { Monque as RootMonque, MonqueEffect as RootEffect } from "@monque/core";
import { Monque, MonqueEffect } from "@monque/core/effect";
import { Context, Deferred, Effect, Layer, Predicate } from "effect";
import { MongoClient } from "mongodb";

class Greeting extends Context.Service<Greeting, { text: string }>()("consumer/Greeting") {}

describe("isolated package consumption", () => {
  it.live(
    "packed native entrypoints run scoped workers with host services",
    () =>
      Effect.gen(function* packedConsumer() {
        assert.strictEqual(Monque, RootMonque);
        assert.strictEqual(MonqueEffect, RootEffect);
        const require = createRequire(import.meta.url);
        const rootEntry: unknown = require("@monque/core");
        const effectEntry: unknown = require("@monque/core/effect");
        assert.ok(Predicate.hasProperty(rootEntry, "Monque"));
        assert.ok(Predicate.hasProperty(rootEntry, "MonqueEffect"));
        assert.ok(Predicate.hasProperty(effectEntry, "Monque"));
        assert.ok(Predicate.hasProperty(effectEntry, "MonqueEffect"));
        assert.strictEqual(effectEntry.MonqueEffect, rootEntry.MonqueEffect);
        assert.strictEqual(effectEntry.Monque, rootEntry.Monque);

        const client = yield* Effect.acquireRelease(
          Effect.tryPromise(async () => {
            const mongo = new MongoClient(process.env.MONQUE_VERIFY_URI ?? "", {
              directConnection: true,
            });

            await mongo.connect();

            return mongo;
          }),
          (mongo) =>
            Effect.promise(async () => {
              await mongo.close();
            }),
        );

        const db = client.db("packed_effect");
        const completed = yield* Deferred.make<undefined>();

        const workers = MonqueEffect.layer(db, {}, (monque) =>
          monque.effects.register("greet", () =>
            Effect.gen(function* greet() {
              const greeting = yield* Greeting;
              assert.strictEqual(greeting.text, "hello");
              yield* Deferred.succeed(completed, undefined);
            }),
          ),
        ).pipe(Layer.provide(Layer.succeed(Greeting, { text: "hello" })));

        yield* Effect.gen(function* application() {
          const scheduler = yield* MonqueEffect;
          assert.strictEqual(yield* scheduler.isHealthy, true);
          const job = yield* scheduler.now("greet", {});
          assert.strictEqual((yield* scheduler.getJob(job._id))?.name, "greet");
          yield* Deferred.await(completed);
          yield* scheduler.stop;
        }).pipe(Effect.provide(workers));
        const ping = yield* Effect.tryPromise(async () => await db.command({ ping: 1 }));
        assert.strictEqual(ping.ok, 1);
      }),
    120_000,
  );
});
