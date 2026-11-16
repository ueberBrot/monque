import { describe, it, expect } from "@effect/vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import { Context, Data, Deferred, Effect, Exit, Fiber, Layer, Scheduler } from "effect";
import { TestClock } from "effect/testing";
import { ObjectId } from "mongodb";
import type { Collection, Db, UpdateResult } from "mongodb";
import { vi } from "vite-plus/test";

import { MonqueEffect } from "@/effect.js";
import { Monque, JobStatus } from "@/index.js";
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

it.effect("runs setup before starting and publishes the same instance", () =>
  Effect.gen(function* orderedSetup() {
    const collection = fromPartial<Collection>({
      updateMany: async () => await Promise.resolve(fromPartial<UpdateResult>({})),
      findOne: async () => await Promise.resolve(null),
    });

    const db = fromPartial<Db>({ collection: () => collection });
    const instances: Monque[] = [];

    const layer = MonqueEffect.layer(
      db,
      { skipIndexCreation: true, recoverStaleJobs: false },
      Effect.fnUntraced(function* setup(monque) {
        instances.push(monque);
        expect(monque.isHealthy()).toBe(false);
        yield* monque.effects.register("mail", () => Effect.void);

        return "registered";
      }),
    );

    const scheduler = yield* MonqueEffect.pipe(
      Effect.tap((service) =>
        Effect.gen(function* inspectStartedService() {
          expect(service).toBe(instances[0]?.effects);
          expect(yield* service.isHealthy).toBe(true);
        }),
      ),
      Effect.provide(layer),
    );

    expect(Exit.isFailure(yield* Effect.exit(scheduler.start))).toBe(true);
  }),
);

it.effect("releases setup resources and the scheduler when setup fails", () =>
  Effect.gen(function* failedSetup() {
    const SetupFailure = Data.TaggedError("SetupFailure");
    const failure = new SetupFailure(undefined);
    const actions: string[] = [];
    const instances: Monque[] = [];

    const collection = fromPartial<Collection>({
      updateMany: async () => await Promise.resolve(fromPartial<UpdateResult>({})),
      findOne: async () => await Promise.resolve(null),
    });

    const db = fromPartial<Db>({ collection: () => collection });

    const layer = MonqueEffect.layer(
      db,
      { skipIndexCreation: true, recoverStaleJobs: false },
      Effect.fnUntraced(function* setup(monque) {
        instances.push(monque);
        yield* Effect.acquireRelease(
          Effect.sync(() => actions.push("acquire")),
          () =>
            Effect.sync(() => {
              actions.push("release");
            }),
        );
        yield* monque.effects.register("mail", () => Effect.void);

        return yield* failure;
      }),
    );

    const recovered = yield* MonqueEffect.pipe(
      Effect.provide(layer),
      Effect.catch((error) => Effect.succeed(error)),
    );

    expect(recovered).toBe(failure);
    expect(actions).toStrictEqual(["acquire", "release"]);
    const [instance] = instances;
    expect(instance).toBeDefined();
    expect(() => instance?.start()).toThrow("disposed");
  }),
);

it.effect("keeps setup resources alive until active Worker finalizers finish", () =>
  Effect.gen(function* setupResourceLifetime() {
    const started = yield* Deferred.make<undefined>();
    const actions: string[] = [];
    let resourceOpen = false;
    const job = JobFactoryHelpers.processing({ name: "mail" });

    const collection = fromPartial<Collection>({
      updateMany: async () => await Promise.resolve(fromPartial<UpdateResult>({})),
      findOne: async () => await Promise.resolve(null),
      options: async () => await Promise.resolve({ collation: { locale: "en" } }),
      findOneAndUpdate: vi
        .fn<Collection["findOneAndUpdate"]>()
        .mockResolvedValueOnce(job)
        .mockResolvedValue(null),
    });

    const db = fromPartial<Db>({ collection: () => collection });
    yield* MonqueEffect.pipe(
      Effect.andThen(Deferred.await(started)),
      Effect.provide(
        MonqueEffect.layer(
          db,
          {
            skipIndexCreation: true,
            recoverStaleJobs: false,
            workerConcurrency: 1,
            shutdownTimeout: 0,
          },
          Effect.fnUntraced(function* setup(monque) {
            yield* Effect.acquireRelease(
              Effect.sync(() => {
                resourceOpen = true;
              }),
              () =>
                Effect.sync(() => {
                  resourceOpen = false;
                  actions.push("setup released");
                }),
            );
            yield* monque.effects.register("mail", () =>
              Deferred.succeed(started, undefined).pipe(
                Effect.andThen(Effect.never),
                Effect.ensuring(
                  Effect.sync(() => {
                    actions.push(resourceOpen ? "Worker released" : "Worker resource closed");
                  }),
                ),
              ),
            );
          }),
        ),
      ),
    );

    expect(actions).toStrictEqual(["Worker released", "setup released"]);
  }),
);

it.effect("disposes a partially configured scheduler when setup is interrupted", () =>
  Effect.gen(function* interruptedSetup() {
    const acquired = yield* Deferred.make<Monque>();

    const collection = fromPartial<Collection>({
      updateMany: async () => await Promise.resolve(fromPartial<UpdateResult>({})),
      findOne: async () => await Promise.resolve(null),
    });

    const db = fromPartial<Db>({ collection: () => collection });

    const layer = MonqueEffect.layer(
      db,
      { skipIndexCreation: true, recoverStaleJobs: false },
      (monque) => Deferred.succeed(acquired, monque).pipe(Effect.andThen(Effect.never)),
    );

    const fiber = yield* MonqueEffect.pipe(Effect.provide(layer), Effect.forkChild);
    const monque = yield* Deferred.await(acquired);
    yield* Fiber.interrupt(fiber);
    expect(() => {
      monque.start();
    }).toThrow("disposed");
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
          const scheduler = yield* MonqueEffect;
          yield* Deferred.await(started);
          expect(actions).toStrictEqual(["acquire"]);
          yield* TestClock.adjust(1000);
          yield* Deferred.await(completed);
          expect(actions).toStrictEqual(["acquire", "send", "release"]);
          yield* scheduler.stop;
        }).pipe(
          Effect.provide(
            MonqueEffect.layer(
              db,
              { skipIndexCreation: true, recoverStaleJobs: false, workerConcurrency: 1 },
              Effect.fnUntraced(function* setup(monque) {
                monque.on("job:complete", () => {
                  Deferred.doneUnsafe(completed, Effect.void);
                });
                yield* monque.effects.register("mail", () => makeMailWorker(actions, started));
              }),
            ).pipe(
              Layer.provide(
                Layer.succeed(Mailer, {
                  send: Effect.sync(() => {
                    actions.push("send");
                  }),
                }),
              ),
            ),
          ),
        ),
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
