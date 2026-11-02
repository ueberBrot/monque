import { it as effectIt } from "@effect/vitest";
import { Context, Effect, Layer, ManagedRuntime, Result } from "effect";
import { TestClock } from "effect/testing";
import { ObjectId } from "mongodb";
import { describe, expect, it } from "vite-plus/test";

import { makeSchedulerLayer, SchedulerServices } from "@/scheduler/runtime.js";
import { JobPersistence } from "@/scheduler/services/job-persistence.js";
import { createMockContext } from "@tests/factories";

describe("composed initialization", () => {
  effectIt.effect("releases maintenance schedules with their owning instance scope", () =>
    Effect.gen(function* releaseMaintenance() {
      const ctx = createMockContext();
      ctx.options.recoverStaleJobs = false;
      ctx.options.jobRetention = { completed: 60_000, interval: 1000 };
      const context = yield* Effect.context();
      let maintenanceWrites = 0;
      ctx.mockCollection.deleteMany.mockImplementation(async () => {
        maintenanceWrites += 1;

        return await Promise.resolve({ acknowledged: true, deletedCount: 0 });
      });

      yield* Effect.gen(function* startMaintenance() {
        const services = yield* makeSchedulerLayer(ctx, {
          runFork: Effect.runForkWith(context),
        }).pipe(
          Layer.build,
          Effect.map((built) => Context.get(built, SchedulerServices)),
        );

        yield* services.timers.start;
        yield* TestClock.adjust(1000);
        expect(maintenanceWrites).toBe(2);
      }).pipe(Effect.scoped);

      yield* TestClock.adjust(3000);
      expect(maintenanceWrites).toBe(2);
    }),
  );

  it("shares acquisition across concurrent reads and waits for full readiness", async () => {
    const acquired: PromiseWithResolvers<void> = Promise.withResolvers();
    const ready: PromiseWithResolvers<void> = Promise.withResolvers();
    let acquisitions = 0;
    let releases = 0;
    let reads = 0;

    const persistence = Layer.effect(
      JobPersistence,
      Effect.gen(function* acquirePersistence() {
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            acquisitions += 1;
            acquired.resolve();
          }),
          () =>
            Effect.sync(() => {
              releases += 1;
            }),
        );
        yield* Effect.promise(async () => {
          await ready.promise;
        });

        return JobPersistence.of({
          getJob: () =>
            Effect.sync(() => {
              reads += 1;

              return null;
            }),
        });
      }),
    );

    const ctx = createMockContext();

    ctx.options.recoverStaleJobs = false;

    const runtime = ManagedRuntime.make(
      makeSchedulerLayer(ctx, { runFork: Effect.runFork }, persistence).pipe(Layer.orDie),
    );

    try {
      const read = JobPersistence.use((store) => store.getJob(new ObjectId()));
      const waiters = [runtime.runPromise(read), runtime.runPromise(read)];
      await acquired.promise;
      expect({ acquisitions, releases, reads }).toStrictEqual({
        acquisitions: 1,
        releases: 0,
        reads: 0,
      });
      ready.resolve();
      await expect(Promise.all(waiters)).resolves.toStrictEqual([null, null]);
      expect({ acquisitions, releases, reads }).toStrictEqual({
        acquisitions: 1,
        releases: 0,
        reads: 2,
      });
    } finally {
      ready.resolve();
      await runtime.dispose();
    }

    expect(releases).toBe(1);
  });

  effectIt.effect(
    "releases resources when composed initialization fails and permits a fresh attempt",
    () =>
      Effect.gen(function* initializeWithOwnedResource() {
        const failure = new Error("Persistence unavailable");
        let acquisitions = 0;
        let releases = 0;

        const resource = Effect.acquireRelease(
          Effect.sync(() => {
            acquisitions += 1;
          }),
          () =>
            Effect.sync(() => {
              releases += 1;
            }),
        );

        const persistence = Layer.effect(
          JobPersistence,
          Effect.gen(function* acquirePersistence() {
            yield* resource;

            if (acquisitions === 1) {
              return yield* Effect.fail(failure);
            }

            return JobPersistence.of({ getJob: () => Effect.succeed(null) });
          }),
        );

        const ctx = createMockContext();
        ctx.options.recoverStaleJobs = false;

        const failed = yield* makeSchedulerLayer(
          ctx,
          { runFork: Effect.runFork },
          persistence,
        ).pipe(Layer.build, Effect.scoped, Effect.result);

        expect(failed).toStrictEqual(Result.fail(failure));
        expect({ acquisitions, releases }).toStrictEqual({ acquisitions: 1, releases: 1 });

        yield* Effect.gen(function* readAfterRetry() {
          const context = yield* makeSchedulerLayer(
            ctx,
            { runFork: Effect.runFork },
            persistence,
          ).pipe(Layer.build);

          const job = yield* JobPersistence.use((store) => store.getJob(new ObjectId())).pipe(
            Effect.provideContext(context),
          );

          expect(job).toBeNull();
          expect({ acquisitions, releases }).toStrictEqual({ acquisitions: 2, releases: 1 });
        }).pipe(Effect.scoped);
        expect({ acquisitions, releases }).toStrictEqual({ acquisitions: 2, releases: 2 });
      }),
  );
});
