import { describe, it, expect } from "@effect/vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import { Context, Data, Deferred, Effect, Exit, Fiber, Scheduler } from "effect";
import { TestClock } from "effect/testing";
import { ObjectId } from "mongodb";
import type { Collection, Db, UpdateResult } from "mongodb";
import { vi } from "vite-plus/test";

import { Monque, JobStatus, MonqueEffect } from "@/index.js";
import { JobFactoryHelpers } from "@tests/factories";

it.effect("acquires a producer, composes reads and closes admission with its scope", () =>
  Effect.gen(function* producerScope() {
    const collection = fromPartial<Collection>({
      updateMany: async () =>
        await Promise.resolve({
          acknowledged: true,
          matchedCount: 0,
          modifiedCount: 0,
          upsertedCount: 0,
          upsertedId: null,
        }),
      findOne: async () => await Promise.resolve(null),
    });

    const db = fromPartial<Db>({ collection: () => collection });

    const service = yield* Effect.scoped(
      Effect.gen(function* service() {
        const scheduler = yield* MonqueEffect;
        expect(yield* scheduler.getJob("000000000000000000000001")).toBeNull();

        return scheduler;
      }).pipe(
        Effect.provide(
          MonqueEffect.layer(db, { skipIndexCreation: true, recoverStaleJobs: false }),
        ),
      ),
    );

    expect(Exit.isFailure(yield* Effect.exit(service.now("mail", {})))).toBe(true);
  }),
);

class Mailer extends Context.Service<Mailer, { send: Effect.Effect<void> }>()("test/Mailer") {}

const makeMailWorker = (
  actions: string[],
  started: Deferred.Deferred<Effect.Success<typeof Effect.void>>,
) =>
  Effect.gen(function* sendMail() {
    const mailer = yield* Mailer;
    yield* Effect.acquireRelease(
      Effect.sync(() => actions.push("acquire")),
      () =>
        Effect.sync(() => {
          actions.push("release");
        }),
    );
    yield* Deferred.succeed(started, undefined);
    yield* Effect.sleep(1000);
    yield* mailer.send;
  });

describe("native Workers", () => {
  it.effect("uses application services, virtual time and per-attempt finalizers", () =>
    Effect.gen(function* nativeWorkerResources() {
      const started = yield* Deferred.make<Effect.Success<typeof Effect.void>>();
      const completed = yield* Deferred.make<Effect.Success<typeof Effect.void>>();
      const actions: string[] = [];
      const job = JobFactoryHelpers.processing({ name: "mail" });

      const findOneAndUpdate = vi
        .fn<Collection["findOneAndUpdate"]>()
        .mockResolvedValueOnce(job)
        .mockResolvedValueOnce({ ...job, status: JobStatus.COMPLETED })
        .mockResolvedValue(null);

      const collection = fromPartial<Collection>({
        updateMany: async () => await Promise.resolve(fromPartial<UpdateResult>({})),
        findOne: async () => await Promise.resolve(null),
        options: async () => await Promise.resolve({ collation: { locale: "en" } }),
        findOneAndUpdate,
      });

      const db = fromPartial<Db>({ collection: () => collection });
      yield* Effect.scoped(
        Effect.gen(function* scopedWorker() {
          const monque = yield* Monque.scoped(db, {
            skipIndexCreation: true,
            recoverStaleJobs: false,
            workerConcurrency: 1,
          });

          monque.on("job:complete", () => {
            Deferred.doneUnsafe(completed, Effect.void);
          });
          yield* monque.effects
            .register("mail", () => makeMailWorker(actions, started))
            .pipe(
              Effect.provideService(Mailer, {
                send: Effect.sync(() => {
                  actions.push("send");
                }),
              }),
            );
          yield* monque.effects.start;
          yield* Deferred.await(started);
          expect(actions).toStrictEqual(["acquire"]);
          yield* TestClock.adjust(1000);
          yield* Deferred.await(completed);
          expect(actions).toStrictEqual(["acquire", "send", "release"]);
          yield* monque.effects.stop;
        }),
      );
    }),
  );
});

describe("synchronous controls", () => {
  it("ordinary controls still throw synchronously after native disposal", async () => {
    const monque = new Monque(fromPartial<Db>({}));
    await monque.dispose();
    expect(() => {
      monque.start();
    }).toThrow("disposed");
  });
});

describe("native admission ownership", () => {
  it.each(Array.from({ length: 12 }, (_, index) => index + 1))(
    "disposes after caller interruption at native read yield point %i",
    async (target) => {
      const collection = fromPartial<Collection>({
        updateMany: async () => await Promise.resolve(fromPartial<UpdateResult>({})),
        findOne: async () => await Promise.resolve(null),
      });

      const monque = new Monque(fromPartial<Db>({ collection: () => collection }), {
        skipIndexCreation: true,
        recoverStaleJobs: false,
      });

      await monque.initialize();

      let steps = 0;
      const scheduler = new Scheduler.MixedScheduler();

      scheduler.shouldYield = (fiber) => {
        steps += 1;

        if (steps === target) {
          queueMicrotask(() => {
            fiber.interruptUnsafe();
          });

          return true;
        }

        return false;
      };

      const fiber = Effect.runFork(monque.effects.getJob("000000000000000000000001"), {
        scheduler,
      });

      await Effect.runPromise(Fiber.await(fiber));
      await expect(monque.dispose()).resolves.toBeUndefined();
    },
    1000,
  );

  it("settles a started producer write before interruption and disposal finish", async () => {
    const started = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();

    const collection = fromPartial<Collection>({
      updateMany: async () => await Promise.resolve(fromPartial<UpdateResult>({})),
      findOne: async () => await Promise.resolve(null),
      insertOne: async () => {
        started.resolve(undefined);
        await release.promise;

        return { acknowledged: true, insertedId: new ObjectId() };
      },
    });

    const monque = new Monque(fromPartial<Db>({ collection: () => collection }), {
      skipIndexCreation: true,
      recoverStaleJobs: false,
    });

    await monque.initialize();
    const fiber = Effect.runFork(monque.effects.now("mail", {}));
    await started.promise;
    const interrupting = Effect.runPromise(Fiber.interrupt(fiber));
    let disposed = false;

    const disposal = (async () => {
      await monque.dispose();
      disposed = true;
    })();

    await Promise.resolve();
    expect(disposed).toBe(false);
    release.resolve(undefined);
    await Promise.all([interrupting, disposal]);
    expect(disposed).toBe(true);
  });

  it.effect("recovers acquisition failure without taking ownership of the database", () =>
    Effect.gen(function* acquisitionFailure() {
      const DatabaseUnavailable = Data.TaggedError("DatabaseUnavailable");

      const problem = new DatabaseUnavailable(undefined);

      const updateMany = vi
        .fn<Collection["updateMany"]>()
        .mockRejectedValueOnce(problem)
        .mockResolvedValue(fromPartial<UpdateResult>({}));

      const collection = fromPartial<Collection>({
        updateMany,
        findOne: async () => await Promise.resolve(null),
      });

      const db = fromPartial<Db>({ collection: () => collection });
      const layer = MonqueEffect.layer(db, { skipIndexCreation: true, recoverStaleJobs: false });
      const failed = yield* Effect.exit(MonqueEffect.pipe(Effect.provide(layer)));
      expect(Exit.isFailure(failed)).toBe(true);

      const result = yield* MonqueEffect.use((scheduler) =>
        scheduler.getJob("000000000000000000000001"),
      ).pipe(Effect.provide(layer));

      expect(result).toBeNull();
    }),
  );
});
