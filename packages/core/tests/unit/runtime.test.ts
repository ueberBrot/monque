import { it as effectIt } from "@effect/vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import { Context, Deferred, Effect, Fiber, Layer, ManagedRuntime, Result } from "effect";
import { ObjectId } from "mongodb";
import { describe, expect, it, vi } from "vite-plus/test";

import { makeSchedulerLayer, SchedulerServices } from "@/scheduler/runtime.js";
import { JobPersistence } from "@/scheduler/services/job-persistence.js";
import { JobQueries } from "@/scheduler/services/job-queries.js";
import { WorkerAdmission } from "@/scheduler/services/worker-admission.js";
import { createMockContext, JobFactoryHelpers } from "@tests/factories";

describe("composed initialization", () => {
  effectIt.effect(
    "keeps captured Worker observations current through replacement and release",
    () =>
      Effect.gen(function* liveWorkerObservations() {
        const ctx = createMockContext();
        ctx.options.recoverStaleJobs = false;
        ctx.options.instanceConcurrency = 1;
        ctx.mockCollection.aggregate.mockReturnValue(
          fromPartial<ReturnType<typeof ctx.mockCollection.aggregate>>({
            toArray: vi.fn<() => Promise<never[]>>().mockResolvedValue([]),
            close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
          }),
        );

        const environment = {
          ...ctx,
          workers: ctx.workers,
          isPaused: (name?: string) => ctx.admission.isPaused(name),
        };

        const context = yield* makeSchedulerLayer(environment, { runFork: Effect.runFork }).pipe(
          Layer.build,
        );

        const reads = Context.get(context, JobQueries);
        const admission = Context.get(context, WorkerAdmission);

        expect(Context.get(context, SchedulerServices).queries).toBe(reads);
        expect(yield* reads.getQueueViewSummaries()).toStrictEqual([]);

        admission.register("work", () => {}, { concurrency: 2 });

        const release = admission.beginExecution(
          "work",
          JobFactoryHelpers.processing({ name: "work" }),
        );

        const active = yield* reads.getQueueViewSummaries();

        expect(active).toMatchObject([
          { worker: { concurrency: 2, activeCount: 1, paused: false } },
        ]);

        admission.register("work", () => {}, { replace: true, concurrency: 3 });
        admission.register("later", () => {});
        admission.pause("work");
        admission.stop();
        admission.start();
        expect({
          availableSlots: admission.availableSlots("later"),
          views: yield* reads.getQueueViewSummaries(),
        }).toMatchObject({
          availableSlots: 0,
          views: [
            { name: "later", worker: { activeCount: 0, paused: false } },
            { name: "work", worker: { concurrency: 3, activeCount: 1, paused: true } },
          ],
        });

        release();

        const releaseLater = admission.beginExecution(
          "later",
          JobFactoryHelpers.processing({ name: "later" }),
        );

        release();

        const occupiedAfterRepeatedRelease = admission.availableSlots("work");

        releaseLater();
        expect({
          occupiedAfterRepeatedRelease,
          availableSlots: admission.availableSlots("work"),
          views: yield* reads.getQueueViewSummaries(),
          previousSnapshot: active,
        }).toMatchObject({
          occupiedAfterRepeatedRelease: 0,
          availableSlots: 1,
          views: [
            { name: "later", worker: { activeCount: 0 } },
            { name: "work", worker: { concurrency: 3, activeCount: 0, paused: true } },
          ],
          previousSnapshot: [{ worker: { concurrency: 2, activeCount: 1, paused: false } }],
        });
      }).pipe(Effect.scoped),
  );

  effectIt.effect("keeps immediate Worker controls while the composed Layer awaits readiness", () =>
    Effect.gen(function* controlsDuringAcquisition() {
      const ctx = createMockContext();
      ctx.options.recoverStaleJobs = false;
      const acquiring = yield* Deferred.make<Effect.Success<typeof Effect.void>>();
      const ready = yield* Deferred.make<Effect.Success<typeof Effect.void>>();

      const persistence = Layer.effect(
        JobPersistence,
        Effect.gen(function* awaitReadiness() {
          yield* Deferred.succeed(acquiring, undefined);
          yield* Deferred.await(ready);

          return JobPersistence.of({ getJob: () => Effect.succeed(null) });
        }),
      );

      const build = yield* makeSchedulerLayer(ctx, { runFork: Effect.runFork }, persistence).pipe(
        Layer.build,
        Effect.forkChild,
      );

      yield* Deferred.await(acquiring);
      ctx.admission.register("work", () => {}, { concurrency: 2 });
      ctx.admission.pause("work");
      yield* Deferred.succeed(ready, undefined);
      const context = yield* Fiber.join(build);
      const admission = Context.get(context, WorkerAdmission);
      expect(admission.processingState("work")).toMatchObject({
        paused: true,
        globallyPaused: false,
      });
      expect(admission.availableSlots("work")).toBe(2);
      admission.resume("work");
      expect(ctx.admission.isPaused("work")).toBe(false);
    }).pipe(Effect.scoped),
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
