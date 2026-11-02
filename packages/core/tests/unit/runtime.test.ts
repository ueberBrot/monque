import { EventEmitter } from "node:events";
import { it as effectIt } from "@effect/vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import {
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  ManagedRuntime,
  Result,
  Scope,
} from "effect";
import { TestClock } from "effect/testing";
import { ObjectId } from "mongodb";
import type { ChangeStream } from "mongodb";
import { describe, expect, it, vi } from "vite-plus/test";

import { JobStatus } from "@/jobs";
import { makeSchedulerLayer, ProcessingResources } from "@/scheduler/runtime.js";
import { JobManagement } from "@/scheduler/services/job-manager.js";
import { JobPersistence } from "@/scheduler/services/job-persistence.js";
import { JobQueries } from "@/scheduler/services/job-queries.js";
import { WorkerAdmission } from "@/scheduler/services/worker-admission.js";
import { ConnectionError } from "@/shared";
import { createMockContext, createWorker, JobFactoryHelpers } from "@tests/factories";
import { anyMatcher, objectContainingMatcher } from "@tests/setup/matchers.js";

describe("composed initialization", () => {
  effectIt.effect("recovers before checking collisions and routes recovery synchronously", () =>
    Effect.gen(function* initializeRecovery() {
      const order: string[] = [];
      const ctx = createMockContext();
      ctx.mockCollection.updateMany.mockImplementationOnce(async () => {
        order.push("recover");

        return await Promise.resolve({
          acknowledged: true,
          matchedCount: 2,
          modifiedCount: 2,
          upsertedCount: 0,
          upsertedId: null,
        });
      });
      ctx.emit.mockImplementation((event) => {
        order.push(event);

        return true;
      });
      ctx.notifyPendingJob.mockImplementation((name, nextRunAt) => {
        expect({ name, nextRunAt }).toStrictEqual({ name: undefined, nextRunAt: new Date(1234) });
        order.push("pending");
      });
      ctx.mockCollection.findOne.mockImplementationOnce(async () => {
        order.push("collision");

        return await Promise.resolve(JobFactoryHelpers.processing({ name: "email" }));
      });
      yield* TestClock.setTime(1234);
      const error = yield* makeSchedulerLayer(ctx).pipe(Layer.build, Effect.flip);
      expect(order).toStrictEqual(["recover", "stale:recovered", "pending", "collision"]);
      expect(ctx.emit).toHaveBeenCalledExactlyOnceWith("stale:recovered", { count: 2 });
      expect(error).toBeInstanceOf(ConnectionError);
      expect(error).toHaveProperty(
        "message",
        'Another active Monque instance is using schedulerInstanceId "test-instance-id". ' +
          'Found processing job "email" with recent heartbeat. ' +
          "Use a unique schedulerInstanceId or wait for the other instance to stop.",
      );
    }),
  );

  effectIt.effect.each(["native", "listener"] as const)(
    "preserves %s recovery failure and allows a fresh initialization attempt",
    (stage) =>
      Effect.gen(function* retryRecovery() {
        const ctx = createMockContext();
        const failure = new Error("recovery failed");
        ctx.mockCollection.updateMany.mockResolvedValue({
          acknowledged: true,
          matchedCount: 1,
          modifiedCount: 1,
          upsertedCount: 0,
          upsertedId: null,
        });

        if (stage === "native") {
          ctx.mockCollection.updateMany.mockRejectedValueOnce(failure);
        } else {
          ctx.emit.mockImplementationOnce(() => {
            throw failure;
          });
        }

        const error = yield* makeSchedulerLayer(ctx).pipe(Layer.build, Effect.scoped, Effect.flip);
        expect(error).toBe(failure);
        expect(ctx.notifyPendingJob).not.toHaveBeenCalled();
        expect(ctx.mockCollection.findOne).not.toHaveBeenCalled();
        ctx.mockCollection.findOne.mockResolvedValueOnce(null);
        yield* makeSchedulerLayer(ctx).pipe(Layer.build);
        expect(ctx.notifyPendingJob).toHaveBeenCalledOnce();
        expect(ctx.mockCollection.findOne).toHaveBeenCalledOnce();
      }),
  );

  effectIt.effect.each([0, null])("initializes without recovery notification for %s", (count) =>
    Effect.gen(function* noRecoveryNotification() {
      const ctx = createMockContext();
      ctx.options.recoverStaleJobs = count !== null;
      ctx.mockCollection.updateMany.mockResolvedValue({
        acknowledged: true,
        matchedCount: 0,
        modifiedCount: 0,
        upsertedCount: 0,
        upsertedId: null,
      });
      ctx.mockCollection.findOne.mockResolvedValueOnce(null);
      yield* makeSchedulerLayer(ctx).pipe(Layer.build);
      expect(ctx.mockCollection.updateMany).toHaveBeenCalledTimes(count === null ? 0 : 1);
      expect(ctx.emit).not.toHaveBeenCalled();
      expect(ctx.notifyPendingJob).not.toHaveBeenCalled();
      expect(ctx.mockCollection.findOne).toHaveBeenCalledOnce();
    }),
  );

  effectIt.effect("retains an active Promise execution until its initialized owner can close", () =>
    Effect.gen(function* closeExecutionOwner() {
      const ctx = createMockContext();
      ctx.options.recoverStaleJobs = false;
      const started = yield* Deferred.make<Effect.Success<typeof Effect.void>>();
      const finished = yield* Deferred.make<Effect.Success<typeof Effect.void>>();
      const release = Promise.withResolvers<Effect.Success<typeof Effect.void>>();
      ctx.admission.register("email", async () => {
        Deferred.doneUnsafe(started, Effect.void);
        await release.promise;
      });
      ctx.notifyJobFinished.mockImplementation(() => {
        Deferred.doneUnsafe(finished, Effect.void);
      });
      ctx.mockCollection.aggregate.mockReturnValue(
        fromPartial({
          toArray: async () => await Promise.resolve([{ _id: "email", nextRunAt: new Date(0) }]),
          close: async () => {
            await Promise.resolve();
          },
        }),
      );
      ctx.mockCollection.findOneAndUpdate
        .mockResolvedValueOnce(JobFactoryHelpers.processing({ name: "email" }))
        .mockResolvedValue(null);
      const owner = yield* Scope.make();

      const context = yield* makeSchedulerLayer(ctx).pipe(Layer.buildWithScope(owner));

      const { notifications } = Context.get(context, ProcessingResources);
      let closed = false;

      try {
        notifications.start();
        yield* Deferred.await(started);

        const closing = yield* Scope.close(owner, Exit.void).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              closed = true;
            }),
          ),
          Effect.forkChild,
        );

        yield* TestClock.adjust(1);
        expect({ closed, active: ctx.admission.activeJobs().length }).toStrictEqual({
          closed: false,
          active: 1,
        });
        release.resolve();
        yield* Deferred.await(finished);
        yield* Fiber.join(closing);
        expect({ closed, active: ctx.admission.activeJobs().length }).toStrictEqual({
          closed: true,
          active: 0,
        });
      } finally {
        release.resolve();
        yield* Scope.close(owner, Exit.void);
      }
    }),
  );
  effectIt.effect("invalidates shared reads after a persisted mutation whose listener fails", () =>
    Effect.gen(function* managementInvalidation() {
      const ctx = createMockContext();
      ctx.options.recoverStaleJobs = false;

      const toArray = vi
        .fn<() => Promise<unknown[]>>()
        .mockResolvedValueOnce([{ statusCounts: [], avgDuration: [], total: [{ count: 1 }] }])
        .mockResolvedValueOnce([{ statusCounts: [], avgDuration: [], total: [{ count: 2 }] }]);

      ctx.mockCollection.aggregate.mockReturnValue(
        fromPartial<ReturnType<typeof ctx.mockCollection.aggregate>>({ toArray }),
      );
      const context = yield* makeSchedulerLayer(ctx).pipe(Layer.build);
      const reads = Context.get(context, JobQueries);
      const management = Context.get(context, JobManagement);
      const failure = new Error("Listener failed after persistence");
      ctx.mockCollection.findOneAndUpdate.mockResolvedValueOnce(JobFactoryHelpers.cancelled());
      vi.mocked(ctx.emit).mockImplementationOnce(() => {
        throw failure;
      });
      expect((yield* reads.getQueueStats()).total).toBe(1);
      const result = yield* Effect.result(management.cancelJob(new ObjectId().toHexString()));
      expect(result).toMatchObject({ _tag: "Failure", failure: { cause: failure } });
      expect((yield* reads.getQueueStats()).total).toBe(2);
    }),
  );

  effectIt.effect(
    "keeps reads, maintenance and Promise Workers alive across stream replacement and notification close",
    () =>
      Effect.gen(function* closeOnlyNotifications() {
        const ctx = createMockContext();
        ctx.options.recoverStaleJobs = false;
        ctx.options.leaseDuration = 3000;
        const started = yield* Deferred.make<Effect.Success<typeof Effect.void>>();
        const finished = yield* Deferred.make<Effect.Success<typeof Effect.void>>();
        const reading = yield* Deferred.make<Effect.Success<typeof Effect.void>>();
        const completion = Promise.withResolvers<Effect.Success<typeof Effect.void>>();
        const query = Promise.withResolvers<never[]>();
        const closeRead = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
        const job = JobFactoryHelpers.processing({ name: "email", claimId: "surviving" });
        const streamClosing = yield* Deferred.make<Effect.Success<typeof Effect.void>>();
        const streamClosed = Promise.withResolvers<Effect.Success<typeof Effect.void>>();

        // oxlint-disable-next-line unicorn/prefer-event-target -- Native MongoDB Change Streams use EventEmitter listeners.
        const oldStream = Object.assign(new EventEmitter(), {
          close: vi.fn<() => Promise<void>>(async () => {
            Deferred.doneUnsafe(streamClosing, Effect.void);

            await streamClosed.promise;
          }),
        });

        // oxlint-disable-next-line unicorn/prefer-event-target -- Native MongoDB Change Streams use EventEmitter listeners.
        const replacement = Object.assign(new EventEmitter(), {
          close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        });

        ctx.mockCollection.watch
          .mockReturnValueOnce(fromPartial<ChangeStream>(oldStream))
          .mockReturnValue(fromPartial<ChangeStream>(replacement));

        ctx.admission.register(
          "email",
          async () => {
            Deferred.doneUnsafe(started, Effect.void);
            await completion.promise;
          },
          { concurrency: 1 },
        );
        ctx.notifyJobFinished.mockImplementation(() => {
          Deferred.doneUnsafe(finished, Effect.void);
        });
        ctx.mockCollection.findOneAndUpdate.mockResolvedValueOnce(job).mockResolvedValue(null);
        ctx.mockCollection.updateMany.mockResolvedValue({
          acknowledged: true,
          matchedCount: 1,
          modifiedCount: 1,
          upsertedCount: 0,
          upsertedId: null,
        });
        ctx.mockCollection.aggregate
          .mockReturnValue(
            fromPartial<ReturnType<typeof ctx.mockCollection.aggregate>>({
              toArray: async () => {
                Deferred.doneUnsafe(reading, Effect.void);

                return await query.promise;
              },
              close: closeRead,
            }),
          )
          .mockReturnValueOnce(
            fromPartial<ReturnType<typeof ctx.mockCollection.aggregate>>({
              toArray: vi
                .fn<() => Promise<{ _id: string; nextRunAt: Date }[]>>()
                .mockResolvedValue([{ _id: "email", nextRunAt: new Date(0) }]),
              close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
            }),
          );

        const context = yield* makeSchedulerLayer(ctx).pipe(Layer.build);

        const { notifications, timers, streams } = Context.get(context, ProcessingResources);
        const queries = Context.get(context, JobQueries);
        const run = yield* timers.start;

        try {
          streams.setup();
          notifications.start();
          yield* Deferred.await(started);
          const read = yield* queries.getQueueViewSummaries().pipe(Effect.forkChild);
          yield* Deferred.await(reading);
          const closing = yield* streams.close().pipe(Effect.forkChild);
          yield* Deferred.await(streamClosing);
          streams.setup();
          notifications.close();
          yield* TestClock.adjust(1000);
          expect({
            slots: ctx.admission.availableSlots("email"),
            readClosures: closeRead.mock.calls.length,
          }).toStrictEqual({ slots: 0, readClosures: 0 });
          expect(ctx.mockCollection.updateMany).toHaveBeenCalledExactlyOnceWith(
            objectContainingMatcher({ claimId: { $in: ["surviving"] } }),
            anyMatcher(Array),
          );
          streamClosed.resolve();
          yield* Fiber.join(closing);
          query.resolve([]);
          expect(yield* Fiber.join(read)).toMatchObject([
            { name: "email", worker: { activeCount: 1 } },
          ]);
          yield* run.stop;
          completion.resolve();
          yield* Deferred.await(finished);
          expect(ctx.admission.availableSlots("email")).toBe(1);
          ctx.mockCollection.findOneAndUpdate.mockClear();
          notifications.notifyRunnableJob("email");
          yield* TestClock.adjust(1000);
          expect({
            claims: ctx.mockCollection.findOneAndUpdate.mock.calls.length,
            heartbeats: ctx.mockCollection.updateMany.mock.calls.length,
            oldListeners: oldStream.listenerCount("change"),
            replacementListeners: replacement.listenerCount("change"),
            replacementCloses: replacement.close.mock.calls.length,
          }).toStrictEqual({
            claims: 1,
            heartbeats: 1,
            oldListeners: 0,
            replacementListeners: 1,
            replacementCloses: 0,
          });
        } finally {
          streamClosed.resolve();
          query.resolve([]);
          completion.resolve();
          notifications.close();
          yield* streams.close();
          yield* run.stop;
        }
      }).pipe(Effect.scoped),
  );

  effectIt.effect("owns notification scheduling without starting it during Layer acquisition", () =>
    Effect.gen(function* closeNotificationLayer() {
      const ctx = createMockContext();
      ctx.options.recoverStaleJobs = false;
      ctx.registerWorker("email", createWorker());
      const owner = yield* Scope.make();

      const context = yield* Layer.buildWithScope(makeSchedulerLayer(ctx), owner);

      const { notifications } = Context.get(context, ProcessingResources);
      yield* TestClock.adjust(10_000);
      expect(ctx.mockCollection.aggregate).not.toHaveBeenCalled();
      notifications.notifyRunnableJob("email");
      notifications.notifyPendingJob("email", new Date(20_000));
      yield* Scope.close(owner, Exit.void);
      notifications.start();
      notifications.notifyRunnableJob("email");
      yield* TestClock.adjust(30_000);
      expect(ctx.mockCollection.aggregate).not.toHaveBeenCalled();
      expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
    }),
  );

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

        const context = yield* makeSchedulerLayer(ctx).pipe(Layer.build);

        const reads = Context.get(context, JobQueries);
        const admission = Context.get(context, WorkerAdmission);

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

      const build = yield* makeSchedulerLayer(ctx, persistence).pipe(Layer.build, Effect.forkChild);

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

  effectIt.effect("renews fresh admission records across replacement, drain and restart", () =>
    Effect.gen(function* renewLiveExecutions() {
      const ctx = createMockContext();
      ctx.options.recoverStaleJobs = false;
      ctx.options.leaseDuration = 3000;
      ctx.options.instanceConcurrency = 1;
      ctx.mockCollection.updateMany.mockResolvedValue({
        acknowledged: true,
        matchedCount: 1,
        modifiedCount: 1,
        upsertedCount: 0,
        upsertedId: null,
      });
      const context = yield* makeSchedulerLayer(ctx).pipe(Layer.build);

      const { timers } = Context.get(context, ProcessingResources);
      const admission = Context.get(context, WorkerAdmission);
      const earlier = yield* timers.start;
      admission.register("work", () => {});

      const releaseEarlier = admission.beginExecution(
        "work",
        JobFactoryHelpers.processing({ name: "work", claimId: "earlier" }),
      );

      yield* TestClock.adjust(1000);
      expect(ctx.mockCollection.updateMany).toHaveBeenNthCalledWith(
        1,
        objectContainingMatcher({ claimId: { $in: ["earlier"] }, status: JobStatus.PROCESSING }),
        anyMatcher(Array),
      );
      yield* earlier.beginDrain(true);
      admission.stop();
      admission.start();
      admission.register("work", () => {}, { replace: true });
      expect(admission.availableSlots("work")).toBe(0);
      const later = yield* timers.start;
      yield* later.beginDrain(true);
      yield* earlier.stop;
      yield* earlier.beginDrain(false);
      yield* TestClock.adjust(1000);
      expect(ctx.mockCollection.updateMany).toHaveBeenNthCalledWith(
        2,
        objectContainingMatcher({ claimId: { $in: ["earlier"] } }),
        anyMatcher(Array),
      );
      releaseEarlier();

      const releaseLater = admission.beginExecution(
        "work",
        JobFactoryHelpers.processing({ name: "work", claimId: "later" }),
      );

      releaseEarlier();
      yield* TestClock.adjust(1000);
      expect(ctx.mockCollection.updateMany).toHaveBeenNthCalledWith(
        3,
        objectContainingMatcher({ claimId: { $in: ["later"] } }),
        anyMatcher(Array),
      );
      releaseLater();
      yield* TestClock.adjust(1000);
      expect({
        writes: ctx.mockCollection.updateMany.mock.calls.length,
        slots: admission.availableSlots("work"),
      }).toStrictEqual({ writes: 3, slots: 1 });
      yield* later.stop;
    }).pipe(Effect.scoped),
  );

  effectIt.effect(
    "keeps started native maintenance writes owned by their initialized instance",
    () =>
      Effect.gen(function* awaitOwnedWrites() {
        const ctx = createMockContext();
        ctx.options.recoverStaleJobs = false;
        ctx.options.jobRetention = { completed: 60_000, interval: 1000 };
        const deletion = Promise.withResolvers<{ acknowledged: boolean; deletedCount: number }>();
        ctx.mockCollection.deleteMany.mockReturnValueOnce(deletion.promise);
        const scope = yield* Scope.make();
        let closed = false;

        try {
          const context = yield* makeSchedulerLayer(ctx).pipe(Layer.build, Scope.provide(scope));

          const run = yield* Context.get(context, ProcessingResources).timers.start;
          yield* run.stop;

          const closing = yield* Scope.close(scope, Exit.void).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                closed = true;
              }),
            ),
            Effect.forkChild,
          );

          yield* TestClock.adjust(0);
          expect(closed).toBe(false);

          const other = createMockContext();
          other.options.recoverStaleJobs = false;
          other.options.jobRetention = { completed: 60_000, interval: 1000 };
          other.mockCollection.deleteMany.mockResolvedValue({
            acknowledged: true,
            deletedCount: 0,
          });

          const otherContext = yield* makeSchedulerLayer(other).pipe(Layer.build);

          const otherRun = yield* Context.get(otherContext, ProcessingResources).timers.start;
          yield* TestClock.adjust(1000);
          expect({
            first: ctx.mockCollection.deleteMany.mock.calls.length,
            other: other.mockCollection.deleteMany.mock.calls.length,
          }).toStrictEqual({ first: 1, other: 2 });
          deletion.resolve({ acknowledged: true, deletedCount: 1 });
          yield* Fiber.join(closing);
          yield* otherRun.stop;
          yield* TestClock.adjust(1000);
          expect({ closed, first: ctx.mockCollection.deleteMany.mock.calls.length }).toStrictEqual({
            closed: true,
            first: 1,
          });
        } finally {
          deletion.resolve({ acknowledged: true, deletedCount: 1 });
          yield* Scope.close(scope, Exit.void);
        }
      }).pipe(Effect.scoped),
  );

  effectIt.effect("releases maintenance schedules with their owning instance scope", () =>
    Effect.gen(function* releaseMaintenance() {
      const ctx = createMockContext();
      ctx.options.recoverStaleJobs = false;
      ctx.options.jobRetention = { completed: 60_000, interval: 1000 };
      let maintenanceWrites = 0;
      ctx.mockCollection.deleteMany.mockImplementation(async () => {
        maintenanceWrites += 1;

        return await Promise.resolve({ acknowledged: true, deletedCount: 0 });
      });

      yield* Effect.gen(function* startMaintenance() {
        const services = yield* makeSchedulerLayer(ctx).pipe(
          Layer.build,
          Effect.map((built) => Context.get(built, ProcessingResources)),
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

    const runtime = ManagedRuntime.make(makeSchedulerLayer(ctx, persistence).pipe(Layer.orDie));

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

        const failed = yield* makeSchedulerLayer(ctx, persistence).pipe(
          Layer.build,
          Effect.scoped,
          Effect.result,
        );

        expect(failed).toStrictEqual(Result.fail(failure));
        expect({ acquisitions, releases }).toStrictEqual({ acquisitions: 1, releases: 1 });

        yield* Effect.gen(function* readAfterRetry() {
          const context = yield* makeSchedulerLayer(ctx, persistence).pipe(Layer.build);

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
