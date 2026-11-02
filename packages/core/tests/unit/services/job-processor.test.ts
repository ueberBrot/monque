import { it } from "@effect/vitest";
import { fromAny, fromPartial } from "@total-typescript/shoehorn";
/**
 * Unit tests for JobProcessor service.
 *
 * Tests job polling, acquisition, processing, completion, and failure handling.
 * Uses mock service dependencies to test processing logic in isolation.
 */
import { Clock, Context, Deferred, Effect, Exit, Fiber, Layer, Scope } from "effect";
import { map as mapEffect } from "effect/Effect";
import { isString } from "effect/Predicate";
import { TestClock } from "effect/testing";
import type { FindCursor, Filter, Document, Collection } from "mongodb";
import { ReadConcern } from "mongodb";
import { afterEach, beforeEach, describe, expect, vi } from "vite-plus/test";

import { JobStatus } from "@/jobs";
import type { PersistedJob } from "@/jobs";
import { JobDiscovery } from "@/scheduler/services/job-discovery.js";
import { makeJobExecutionLayer, JobExecution } from "@/scheduler/services/job-execution.js";
import { JobOwnership, makeNativeJobOwnership } from "@/scheduler/services/job-ownership.js";
import { JobProcessor } from "@/scheduler/services/job-processor.js";
import { WorkerAdmission } from "@/scheduler/services/worker-admission.js";
import type { WorkerRegistration } from "@/workers";
import { createMockContext, createWorker, JobFactory, JobFactoryHelpers } from "@tests/factories";
import { clockWithWallTime } from "@tests/setup/clock.js";
import { objectContainingMatcher } from "@tests/setup/matchers.js";
import type { MockFunction } from "@tests/setup/mock-function.js";
import { nativeAsyncMock } from "@tests/setup/native-async-mock.js";

const claimName = (filter: Filter<Document>): string => {
  const name: unknown = filter["name"];

  if (isString(name)) {
    return name;
  }

  throw new Error("Expected a claim query with a Job Name");
};

describe(JobProcessor, () => {
  let ctx: ReturnType<typeof createMockContext>;

  const observeJobCompletion = (count = 1) => {
    const finished = Deferred.makeUnsafe<Effect.Success<typeof Effect.void>>();
    let remaining = count;
    vi.mocked(ctx.notifyJobFinished).mockImplementation(() => {
      remaining -= 1;

      if (remaining === 0) {
        Deferred.doneUnsafe(finished, Effect.void);
      }
    });

    return Deferred.await(finished);
  };

  let processor: JobExecution["Service"];

  const makeProcessor = Effect.fnUntraced(function* makeProcessorFixture() {
    const context = yield* makeJobExecutionLayer(ctx).pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(
            JobOwnership,
            makeNativeJobOwnership(ctx.collection, ctx.instanceId, ctx.options),
          ),
          Layer.succeed(WorkerAdmission, ctx.admission),
        ),
      ),
      Layer.build,
    );

    return Context.get(context, JobExecution);
  });

  beforeEach(() => {
    ctx = createMockContext();
    // Discovery may race another instance's claims; acquisition fixtures remain authoritative.
    vi.mocked(ctx.mockCollection.aggregate).mockImplementation(() =>
      fromAny<ReturnType<typeof ctx.mockCollection.aggregate>, unknown>({
        close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        toArray: nativeAsyncMock<FindCursor["toArray"]>(() =>
          [...ctx.workers.keys()].map((name) => ({ _id: name, nextRunAt: new Date(0) })),
        ),
      }),
    );
  });
  afterEach(() => {
    vi.clearAllMocks();
  });
  it.effect("closes its cursor without reporting an error when its run is interrupted", () =>
    Effect.gen(function* interruptDiscovery() {
      processor = yield* makeProcessor();
      const started = yield* Deferred.make<Effect.Success<typeof Effect.void>>();
      const close = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
      vi.mocked(ctx.mockCollection.aggregate).mockReturnValueOnce(
        fromPartial<ReturnType<typeof ctx.mockCollection.aggregate>>({
          toArray: async () => {
            Deferred.doneUnsafe(started, Effect.void);

            return await Promise.withResolvers<never>().promise;
          },
          close,
        }),
      );
      const discovery = new JobDiscovery(ctx);
      const poll = yield* Effect.forkChild(discovery.discoverDue(new Set(["email"])));
      yield* Deferred.await(started);
      yield* Fiber.interrupt(poll);
      expect(close).toHaveBeenCalledOnce();
      expect(ctx.emitHistory).toStrictEqual([]);
    }),
  );
  describe("poll", () => {
    it.effect("closes obsolete discovery and transfers the current repoll after interruption", () =>
      Effect.gen(function* interruptObsoletePoll() {
        processor = yield* makeProcessor();
        ctx.admission.register("email", () => {});
        ctx.admission.register("sms", () => {});
        const discovering = yield* Deferred.make<Effect.Success<typeof Effect.void>>();
        const claimedCurrent = yield* Deferred.make<Effect.Success<typeof Effect.void>>();
        const result = Promise.withResolvers<never[]>();
        const close = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
        ctx.mockCollection.aggregate.mockReturnValueOnce(
          fromPartial({
            toArray: async () => {
              Deferred.doneUnsafe(discovering, Effect.void);

              return await result.promise;
            },
            close,
          }),
        );
        ctx.mockCollection.findOneAndUpdate.mockImplementationOnce(async () => {
          Deferred.doneUnsafe(claimedCurrent, Effect.void);

          return await Promise.resolve(null);
        });
        let current = true;
        const poll = yield* processor.poll(undefined, () => current).pipe(Effect.forkChild);

        try {
          yield* Deferred.await(discovering);
          current = false;
          yield* processor.poll(new Set(["sms"]), () => true);
          const interrupted = yield* Fiber.interrupt(poll).pipe(Effect.forkChild);
          yield* TestClock.adjust(1);
          expect(close).toHaveBeenCalledOnce();
          yield* Fiber.join(interrupted);
          yield* Deferred.await(claimedCurrent);
          expect(
            ctx.mockCollection.findOneAndUpdate.mock.calls.map(([filter]) => claimName(filter)),
          ).toStrictEqual(["sms"]);
          expect(ctx.emitHistory).toStrictEqual([]);
        } finally {
          result.resolve([]);
          yield* Fiber.interrupt(poll);
        }
      }),
    );

    it.effect("releases a late native Claim when its initialized execution owner has closed", () =>
      Effect.gen(function* closeOwnerDuringClaim() {
        const owner = yield* Scope.make();
        processor = yield* makeProcessor().pipe(Effect.provideService(Scope.Scope, owner));
        const handler = vi.fn<WorkerRegistration["handler"]>();
        ctx.admission.register("email", handler);
        const acquiring = yield* Deferred.make<Effect.Success<typeof Effect.void>>();
        const claim = Promise.withResolvers<PersistedJob>();
        const job = JobFactoryHelpers.processing({ name: "email", claimId: "closed-owner" });
        ctx.mockCollection.findOneAndUpdate.mockImplementationOnce(async () => {
          Deferred.doneUnsafe(acquiring, Effect.void);

          return await claim.promise;
        });
        const polling = yield* processor.poll(new Set(["email"])).pipe(Effect.forkChild);

        try {
          yield* Deferred.await(acquiring);
          yield* Scope.close(owner, Exit.void);
          claim.resolve(job);
          yield* Fiber.join(polling);
          expect({
            executions: handler.mock.calls.length,
            active: ctx.admission.activeJobs(),
          }).toStrictEqual({ executions: 0, active: [] });
          expect(ctx.mockCollection.updateOne).toHaveBeenCalledExactlyOnceWith(
            objectContainingMatcher({ claimId: "closed-owner", claimedBy: ctx.instanceId }),
            objectContainingMatcher({
              $set: objectContainingMatcher({ status: JobStatus.PENDING }),
            }),
          );
        } finally {
          claim.resolve(job);
          yield* Scope.close(owner, Exit.void);
        }
      }),
    );

    it.effect("settles a native Claim through fenced release before polling interruption", () =>
      Effect.gen(function* interruptClaimHandoff() {
        processor = yield* makeProcessor();
        const handler = vi.fn<WorkerRegistration["handler"]>();
        ctx.admission.register("email", handler);
        const acquiring = yield* Deferred.make<Effect.Success<typeof Effect.void>>();
        const claim = Promise.withResolvers<PersistedJob>();
        const job = JobFactoryHelpers.processing({ name: "email", claimId: "late-interrupted" });
        ctx.mockCollection.findOneAndUpdate.mockImplementationOnce(async () => {
          Deferred.doneUnsafe(acquiring, Effect.void);

          return await claim.promise;
        });
        const polling = yield* processor.poll(new Set(["email"])).pipe(Effect.forkChild);

        try {
          yield* Deferred.await(acquiring);
          ctx.admission.stop();
          const interrupting = yield* Fiber.interrupt(polling).pipe(Effect.forkChild);
          yield* TestClock.adjust(1);
          expect(ctx.mockCollection.updateOne).not.toHaveBeenCalled();
          claim.resolve(job);
          yield* Fiber.join(interrupting);
          expect(ctx.mockCollection.updateOne).toHaveBeenCalledExactlyOnceWith(
            objectContainingMatcher({ claimId: "late-interrupted", claimedBy: ctx.instanceId }),
            objectContainingMatcher({
              $set: objectContainingMatcher({ status: JobStatus.PENDING }),
            }),
          );
          expect({
            executions: handler.mock.calls.length,
            active: ctx.admission.activeJobs(),
          }).toStrictEqual({ executions: 0, active: [] });
        } finally {
          claim.resolve(job);
          yield* Fiber.interrupt(polling);
        }
      }),
    );

    it.effect("releases an obsolete in-flight Claim and runs the current repoll", () =>
      Effect.gen(function* replaceRunDuringClaim() {
        processor = yield* makeProcessor();
        const handler = vi.fn<WorkerRegistration["handler"]>();
        ctx.admission.register("email", handler);
        ctx.admission.register("sms", handler);
        const claimed = JobFactoryHelpers.processing({ name: "email", claimId: "obsolete" });
        const acquiring = yield* Deferred.make<Effect.Success<typeof Effect.void>>();
        const acquisition = Promise.withResolvers<PersistedJob>();
        ctx.mockCollection.findOneAndUpdate
          .mockImplementationOnce(async () => {
            Deferred.doneUnsafe(acquiring, Effect.void);

            return await acquisition.promise;
          })
          .mockResolvedValue(null);
        let oldCurrent = true;

        const poll = yield* processor
          .poll(new Set(["email"]), () => oldCurrent)
          .pipe(Effect.forkChild);

        yield* Deferred.await(acquiring);
        oldCurrent = false;

        yield* processor.poll(new Set(["sms"]), () => true);
        acquisition.resolve(claimed);
        yield* Fiber.join(poll);
        expect(handler).not.toHaveBeenCalled();
        expect(
          ctx.mockCollection.findOneAndUpdate.mock.calls
            .filter(([filter]) => filter["status"] === JobStatus.PENDING)
            .map(([filter]) => claimName(filter)),
        ).toStrictEqual(["email", "sms"]);
        expect(ctx.mockCollection.updateOne).toHaveBeenCalledExactlyOnceWith(
          objectContainingMatcher({
            status: JobStatus.PROCESSING,
            claimedBy: ctx.instanceId,
            claimId: "obsolete",
          }),
          objectContainingMatcher({ $set: objectContainingMatcher({ status: JobStatus.PENDING }) }),
        );
      }),
    );

    it.effect("does not claim after its run closes while discovery is awaiting MongoDB", () =>
      Effect.gen(function* stopDuringDiscovery() {
        processor = yield* makeProcessor();
        ctx.registerWorker("email", createWorker());
        const started = yield* Deferred.make<Effect.Success<typeof Effect.void>>();
        const pending = Promise.withResolvers<{ _id: string; nextRunAt: Date }[]>();
        vi.mocked(ctx.mockCollection.aggregate).mockReturnValueOnce(
          fromPartial<ReturnType<typeof ctx.mockCollection.aggregate>>({
            close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
            toArray: async () => {
              Deferred.doneUnsafe(started, Effect.void);

              return await pending.promise;
            },
          }),
        );
        let current = true;
        const poll = yield* Effect.forkChild(processor.poll(undefined, () => current));
        yield* Deferred.await(started);
        current = false;
        pending.resolve([{ _id: "email", nextRunAt: new Date(0) }]);
        yield* Fiber.join(poll);
        expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
      }),
    );
    it.effect("discovers an idle collection once without probing every registered name", () =>
      Effect.gen(function* effectWorkflow1() {
        processor = yield* makeProcessor();

        for (let i = 0; i < 100; i += 1) {
          ctx.registerWorker(`worker-${i}`, createWorker());
        }

        vi.mocked(ctx.mockCollection.aggregate).mockReturnValue(
          fromPartial<ReturnType<typeof ctx.mockCollection.aggregate>>({
            close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
            toArray: vi.fn<MockFunction<FindCursor["toArray"]>>().mockResolvedValue([]),
          }),
        );
        yield* processor.poll();
        expect({
          mockCollectionAggregateMockCallsLength: ctx.mockCollection.aggregate.mock.calls.length,
          mockCollectionFindOneAndUpdateMockCallsLength:
            ctx.mockCollection.findOneAndUpdate.mock.calls.length,
        }).toStrictEqual({
          mockCollectionAggregateMockCallsLength: 1,
          mockCollectionFindOneAndUpdateMockCallsLength: 0,
        });
      }),
    );
    it.effect("arms persisted future deadlines without trying to claim them early", () =>
      Effect.gen(function* effectWorkflow2() {
        processor = yield* makeProcessor();
        ctx.registerWorker("work", createWorker());
        const runAt = new Date(Date.now() + 5000);
        vi.mocked(ctx.mockCollection.aggregate).mockReturnValue(
          fromPartial<ReturnType<typeof ctx.mockCollection.aggregate>>({
            close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
            toArray: vi
              .fn<MockFunction<FindCursor["toArray"]>>()
              .mockResolvedValue([{ _id: "work", nextRunAt: runAt }]),
          }),
        );
        yield* processor.poll();
        expect(ctx.notifyPendingJob).toHaveBeenCalledExactlyOnceWith("work", runAt);
        expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
      }),
    );
    it.effect.each([undefined, "simple"])(
      "keeps binary notifications targeted without a preliminary discovery read, locale: %s",
      (locale) =>
        Effect.gen(function* effectWorkflow3() {
          processor = yield* makeProcessor();

          for (const name of ["work", "unrelated"]) {
            ctx.registerWorker(name, createWorker());
          }

          vi.mocked(ctx.mockCollection.options).mockResolvedValue(
            locale !== undefined && locale !== "" ? { collation: { locale } } : {},
          );
          const claim = vi.mocked(ctx.mockCollection.findOneAndUpdate).mockResolvedValue(null);
          yield* processor.poll(new Set(["work"]));
          yield* processor.poll(new Set(["work"]));
          expect({
            mockCollectionAggregateMockCallsLength: ctx.mockCollection.aggregate.mock.calls.length,
            mockCollectionOptionsMockCallsLength: ctx.mockCollection.options.mock.calls.length,
            claimMockCallsMapFilterFilterName: claim.mock.calls.map(([filter]) =>
              claimName(filter),
            ),
          }).toStrictEqual({
            mockCollectionAggregateMockCallsLength: 0,
            mockCollectionOptionsMockCallsLength: 1,
            claimMockCallsMapFilterFilterName: ["work", "work"],
          });
        }),
    );
    it.effect.each([false, true])(
      "does not retry jobs already claimed on the primary, targeted poll: %s",
      (targeted) =>
        Effect.gen(function* effectWorkflow4() {
          processor = yield* makeProcessor();
          ctx.registerWorker("work", createWorker());
          const staleJob = { _id: "work", nextRunAt: new Date(0) };
          vi.mocked(ctx.mockCollection.aggregate).mockImplementation((_pipeline, options) =>
            fromAny<ReturnType<typeof ctx.mockCollection.aggregate>, unknown>({
              close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
              toArray: nativeAsyncMock<FindCursor["toArray"]>(() =>
                options?.readPreference === "primary" &&
                ReadConcern.fromOptions(options)?.level === "local"
                  ? []
                  : [staleJob],
              ),
            }),
          );
          vi.mocked(ctx.mockCollection.findOneAndUpdate).mockResolvedValue(null);
          vi.mocked(ctx.mockCollection.findOne).mockImplementation(
            nativeAsyncMock<Collection["findOne"]>((_filter, options) =>
              options?.readPreference === "primary" &&
              ReadConcern.fromOptions(options)?.level === "local"
                ? null
                : staleJob,
            ),
          );
          yield* processor.poll(targeted ? new Set(["work"]) : undefined);
          expect({
            notifyPendingJobMockCallsLength: ctx.notifyPendingJob.mock.calls.length,
            mockCollectionFindOneAndUpdateMockCallsLength:
              ctx.mockCollection.findOneAndUpdate.mock.calls.length,
          }).toStrictEqual({
            notifyPendingJobMockCallsLength: 0,
            mockCollectionFindOneAndUpdateMockCallsLength: targeted ? 1 : 0,
          });
        }),
    );
    it.effect("does not turn failed claims into immediate retry notifications", () =>
      Effect.gen(function* effectWorkflow5() {
        processor = yield* makeProcessor();
        ctx.registerWorker("work", createWorker());
        vi.mocked(ctx.mockCollection.findOneAndUpdate).mockRejectedValue(
          new Error("Write unavailable"),
        );
        vi.mocked(ctx.mockCollection.findOne).mockResolvedValue({
          _id: "work",
          nextRunAt: new Date(0),
        });
        yield* processor.poll(new Set(["work"]));
        expect(ctx.notifyPendingJob).not.toHaveBeenCalled();
      }),
    );
    it.effect("falls back to atomic claims when discovery fails", () =>
      Effect.gen(function* effectWorkflow6() {
        processor = yield* makeProcessor();
        ctx.registerWorker("work", createWorker());
        const error = new Error("Read unavailable");
        vi.mocked(ctx.mockCollection.aggregate).mockReturnValue(
          fromPartial<ReturnType<typeof ctx.mockCollection.aggregate>>({
            close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
            toArray: vi.fn<MockFunction<FindCursor["toArray"]>>().mockRejectedValue(error),
          }),
        );
        vi.mocked(ctx.mockCollection.findOneAndUpdate).mockResolvedValue(null);
        yield* processor.poll();
        expect(ctx.emit).toHaveBeenCalledWith("job:error", { error });
        expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalledOnce();
      }),
    );
    it.effect.each(["collation", "metadata unavailable"])(
      "keeps atomic discovery when indexed discovery is unsafe: %s",
      (reason) =>
        Effect.gen(function* effectWorkflow7() {
          processor = yield* makeProcessor();
          ctx.registerWorker("work", createWorker());
          const metadata = vi.mocked(ctx.mockCollection.options);

          if (reason === "collation") {
            metadata.mockResolvedValue({ collation: { locale: "en", strength: 2 } });
          } else {
            metadata.mockRejectedValue(new Error("Collection metadata access denied"));
          }

          vi.mocked(ctx.mockCollection.findOneAndUpdate).mockResolvedValue(null);
          yield* processor.poll();
          yield* processor.poll();
          expect({
            metadataMockCallsLength: metadata.mock.calls.length,
            mockCollectionAggregateMockCallsLength: ctx.mockCollection.aggregate.mock.calls.length,
            mockCollectionFindOneAndUpdateMockCallsLength:
              ctx.mockCollection.findOneAndUpdate.mock.calls.length,
            emitHistoryFilterEventEventJobErrorLength: ctx.emitHistory.filter(
              ({ event }) => event === "job:error",
            ).length,
          }).toStrictEqual({
            metadataMockCallsLength: 1,
            mockCollectionAggregateMockCallsLength: 0,
            mockCollectionFindOneAndUpdateMockCallsLength: 2,
            emitHistoryFilterEventEventJobErrorLength: reason === "collation" ? 0 : 1,
          });
        }),
    );
    it.effect.each(["collation", "metadata unavailable"])(
      "discovers registered names from case-variant notifications with %s",
      (reason) =>
        Effect.gen(function* effectWorkflow8() {
          processor = yield* makeProcessor();

          for (const name of ["email", "unrelated"]) {
            ctx.registerWorker(name, createWorker());
          }

          const metadata = vi.mocked(ctx.mockCollection.options);

          if (reason === "collation") {
            metadata.mockResolvedValue({ collation: { locale: "en", strength: 2 } });
          } else {
            metadata.mockRejectedValue(new Error("Collection metadata access denied"));
          }

          const claim = vi.mocked(ctx.mockCollection.findOneAndUpdate).mockResolvedValue(null);
          yield* processor.poll(new Set(["EMAIL"]));
          yield* processor.poll(new Set(["EMAIL"]));
          expect({
            claimMockCallsMapFilterFilterName: claim.mock.calls.map(([filter]) =>
              claimName(filter),
            ),
            mockCollectionAggregateMockCallsLength: ctx.mockCollection.aggregate.mock.calls.length,
            metadataMockCallsLength: metadata.mock.calls.length,
            emitHistoryFilterEventEventJobErrorLength: ctx.emitHistory.filter(
              ({ event }) => event === "job:error",
            ).length,
          }).toStrictEqual({
            claimMockCallsMapFilterFilterName: ["email", "unrelated", "email", "unrelated"],
            mockCollectionAggregateMockCallsLength: 0,
            metadataMockCallsLength: 1,
            emitHistoryFilterEventEventJobErrorLength: reason === "collation" ? 0 : 1,
          });
        }),
    );
    it.effect(
      "uses an available collation-equivalent worker when the notified worker is full",
      () =>
        Effect.gen(function* effectWorkflow9() {
          processor = yield* makeProcessor();
          const job = JobFactoryHelpers.processing({ name: "EMAIL" });
          ctx.registerWorker(
            "EMAIL",
            createWorker({ activeJobs: new Map([[job._id.toHexString(), job]]) }),
          );
          ctx.registerWorker("email", createWorker());
          vi.mocked(ctx.mockCollection.options).mockResolvedValue({
            collation: { locale: "en", strength: 2 },
          });
          const claim = vi.mocked(ctx.mockCollection.findOneAndUpdate).mockResolvedValue(null);
          yield* processor.poll(new Set(["EMAIL"]));
          expect(claim.mock.calls.map(([filter]) => claimName(filter))).toStrictEqual(["email"]);
        }),
    );
    it.effect.each(["stop", "pause"])("does not claim after %s during discovery", (action) =>
      Effect.gen(function* effectWorkflow10() {
        processor = yield* makeProcessor();
        ctx.registerWorker("work", createWorker());

        const discovery = yield* Deferred.make<
          {
            _id: string;
            nextRunAt: Date;
          }[]
        >();

        const discovering = yield* Deferred.make<Effect.Success<typeof Effect.void>>();
        const runPromise = Effect.runPromiseWith(yield* Effect.context());
        vi.mocked(ctx.mockCollection.aggregate).mockReturnValue(
          fromPartial<ReturnType<typeof ctx.mockCollection.aggregate>>({
            close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
            toArray: vi.fn<MockFunction<FindCursor["toArray"]>>(
              async () =>
                await runPromise(
                  Deferred.succeed(discovering, undefined).pipe(
                    Effect.andThen(Deferred.await(discovery)),
                  ),
                ),
            ),
          }),
        );
        const polling = yield* Effect.forkChild(processor.poll());
        yield* Deferred.await(discovering);

        if (action === "stop") {
          ctx.admission.stop();
        } else {
          ctx.admission.pause();
        }

        yield* Deferred.succeed(discovery, [{ _id: "work", nextRunAt: new Date(0) }]);
        yield* Fiber.join(polling);
        expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
      }),
    );
    it.effect.each([false, true])(
      "does not invoke a handler if paused during acquisition (release fails: %s)",
      (releaseFails) => {
        const releaseError = new Error("Release failed");

        return Effect.gen(function* effectWorkflow11() {
          processor = yield* makeProcessor();
          const acquisition = Promise.withResolvers<PersistedJob | null>();
          const acquiring = yield* Deferred.make<Effect.Success<typeof Effect.void>>();
          const claimed = JobFactoryHelpers.processing({ name: "work" });

          const handler = vi
            .fn<MockFunction<WorkerRegistration["handler"]>>()
            .mockResolvedValue(undefined);

          ctx.registerWorker("work", createWorker({ handler }));

          const claim = ctx.mockCollection.findOneAndUpdate.mockImplementationOnce(async () => {
            Deferred.doneUnsafe(acquiring, Effect.void);

            return await acquisition.promise;
          });

          const release = ctx.mockCollection.updateOne;

          if (releaseFails) {
            release.mockRejectedValue(releaseError);
          }

          const polling = yield* Effect.forkChild(processor.poll());
          yield* Deferred.await(acquiring);
          expect(vi.mocked(claim).mock.calls.length).toBeGreaterThan(0);
          ctx.admission.pause();
          acquisition.resolve(claimed);
          yield* Fiber.join(polling);
          expect(handler).not.toHaveBeenCalled();
          expect(release).toHaveBeenCalledOnce();

          if (releaseFails) {
            expect(ctx.emit).toHaveBeenCalledWith("job:error", {
              error: objectContainingMatcher({ message: "Release failed" }),
              job: claimed,
            });
          }
        });
      },
    );
    it.effect("continues processing after a job:start listener throws with one global slot", () =>
      Effect.gen(function* effectWorkflow12() {
        processor = yield* makeProcessor();
        ctx.options.instanceConcurrency = 1;
        const first = JobFactoryHelpers.processing({ name: "test-job" });
        const next = JobFactoryHelpers.processing({ name: "test-job" });

        const handler = vi
          .fn<MockFunction<WorkerRegistration["handler"]>>()
          .mockResolvedValue(undefined);

        const worker = createWorker({ handler });
        ctx.registerWorker("test-job", worker);
        let throwOnStart = true;
        vi.mocked(ctx.emit).mockImplementation((event) => {
          if (event === "job:start" && throwOnStart) {
            throwOnStart = false;
            throw new Error("Metrics listener failed");
          }

          return true;
        });
        vi.spyOn(ctx.mockCollection, "findOneAndUpdate")
          .mockResolvedValueOnce(first)
          .mockResolvedValueOnce(JobFactoryHelpers.pending({ _id: first._id, failCount: 1 }))
          .mockResolvedValueOnce(next)
          .mockResolvedValueOnce(JobFactoryHelpers.completed({ _id: next._id }));
        const firstFinished = observeJobCompletion();
        yield* processor.poll();
        yield* firstFinished;
        const nextFinished = observeJobCompletion();
        yield* processor.poll();
        yield* nextFinished;
        expect(handler).toHaveBeenCalledExactlyOnceWith(next);
        expect({
          workerActiveJobsSize: worker.activeJobs.size,
          notifyJobFinishedMockCallsLength: ctx.notifyJobFinished.mock.calls.length,
        }).toStrictEqual({
          workerActiveJobsSize: 0,
          notifyJobFinishedMockCallsLength: 2,
        });
      }),
    );
    it.effect(
      "does not issue another Claim after a synchronous start listener pauses its Worker",
      () =>
        Effect.gen(function* pauseBetweenClaimBatches() {
          processor = yield* makeProcessor();
          ctx.admission.register("work", () => {}, { concurrency: 5 });
          ctx.emit.mockImplementation((event) => {
            if (event === "job:start") {
              ctx.admission.pause("work");
            }

            return true;
          });
          const finished = observeJobCompletion();
          ctx.mockCollection.findOneAndUpdate
            .mockResolvedValueOnce(JobFactoryHelpers.processing({ name: "work" }))
            .mockResolvedValue(null);
          yield* processor.poll(new Set(["work"]));
          yield* finished;
          expect(
            ctx.mockCollection.findOneAndUpdate.mock.calls.filter(
              ([filter]) => filter["status"] === JobStatus.PENDING,
            ),
          ).toHaveLength(1);
        }),
    );

    it.effect("should not poll if scheduler is not running", () =>
      Effect.gen(function* effectWorkflow13() {
        processor = yield* makeProcessor();
        ctx.admission.stop();
        yield* processor.poll();
        expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
      }),
    );
    it.effect("should poll for each registered worker with available capacity", () =>
      Effect.gen(function* effectWorkflow14() {
        processor = yield* makeProcessor();
        ctx.registerWorker("test-job", createWorker({ concurrency: 2 }));
        vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockResolvedValue(null);
        yield* processor.poll();
        expect(vi.mocked(ctx.mockCollection.findOneAndUpdate).mock.calls.length).toBeGreaterThan(0);
      }),
    );
    it.effect("should skip workers at max concurrency", () =>
      Effect.gen(function* effectWorkflow15() {
        processor = yield* makeProcessor();
        const job = JobFactory.build();
        ctx.registerWorker(
          "test-job",
          createWorker({
            concurrency: 1,
            activeJobs: new Map<string, PersistedJob>([["job-1", job]]),
          }),
        );
        yield* processor.poll();
        expect({
          mockCollectionFindOneAndUpdateMockCallsLength:
            ctx.mockCollection.findOneAndUpdate.mock.calls.length,
          mockCollectionOptionsMockCallsLength: ctx.mockCollection.options.mock.calls.length,
          mockCollectionAggregateMockCallsLength: ctx.mockCollection.aggregate.mock.calls.length,
        }).toStrictEqual({
          mockCollectionFindOneAndUpdateMockCallsLength: 0,
          mockCollectionOptionsMockCallsLength: 0,
          mockCollectionAggregateMockCallsLength: 0,
        });
      }),
    );
    it.effect("should exit early when instanceConcurrency is reached", () =>
      Effect.gen(function* effectWorkflow16() {
        processor = yield* makeProcessor();
        ctx.options.instanceConcurrency = 2;
        const job1 = JobFactory.build({ name: "worker-1" });
        const job2 = JobFactory.build({ name: "worker-2" });

        const { promise: handlerPromise, resolve: resolveHandlers }: PromiseWithResolvers<void> =
          Promise.withResolvers();

        const handler = async () => {
          await handlerPromise;
        };

        ctx.registerWorker("worker-1", createWorker({ concurrency: 5, handler }));
        ctx.registerWorker("worker-2", createWorker({ concurrency: 5, handler }));
        // Occupy instance capacity with two admitted executions.
        vi.spyOn(ctx.mockCollection, "findOneAndUpdate")
          .mockResolvedValueOnce(job1)
          .mockResolvedValueOnce(job2)
          .mockResolvedValue(null);
        const finished = observeJobCompletion(2);
        yield* processor.poll();

        const callsAfterFirstPoll = fromAny<ReturnType<typeof vi.fn>, unknown>(
          ctx.mockCollection.findOneAndUpdate,
        ).mock.calls.length;

        vi.clearAllMocks();
        // Now the counter is at 2 (= instanceConcurrency), a second poll should not acquire
        yield* processor.poll();
        expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
        expect(callsAfterFirstPoll).toBeGreaterThan(0);
        // Clean up dangling promises
        resolveHandlers?.();
        yield* finished;
      }),
    );
    it.effect("should limit job acquisition to available global slots", () =>
      Effect.gen(function* effectWorkflow17() {
        processor = yield* makeProcessor();
        ctx.options.instanceConcurrency = 3;
        const seedJob = JobFactory.build({ name: "worker-1" });
        const newJob = JobFactory.build({ name: "worker-2" });
        ctx.registerWorker("worker-1", createWorker({ concurrency: 5 }));
        ctx.registerWorker("worker-2", createWorker({ concurrency: 5 }));
        // Seed counter to 1 by acquiring seedJob, then return newJob and null
        vi.spyOn(ctx.mockCollection, "findOneAndUpdate")
          .mockResolvedValueOnce(seedJob)
          .mockResolvedValueOnce(newJob)
          .mockResolvedValue(null);
        yield* processor.poll();
        // With instanceConcurrency 3 and starting at 0, poll acquires up to 3 jobs (seedJob and newJob)
        // Should attempt acquisitions
        expect(vi.mocked(ctx.mockCollection.findOneAndUpdate).mock.calls.length).toBeGreaterThan(0);
      }),
    );
    it.effect("should stop acquiring jobs when global limit is reached mid-poll", () =>
      Effect.gen(function* effectWorkflow18() {
        processor = yield* makeProcessor();
        ctx.options.instanceConcurrency = 2;
        const newJob1 = JobFactory.build({ name: "test-job" });
        const newJob2 = JobFactory.build({ name: "test-job" });
        ctx.registerWorker("test-job", createWorker({ concurrency: 10 }));

        const spy = vi
          .spyOn(ctx.mockCollection, "findOneAndUpdate")
          .mockResolvedValueOnce(newJob1)
          .mockResolvedValueOnce(newJob2)
          .mockResolvedValue(null);

        yield* processor.poll();

        // Should acquire exactly 2 jobs (the instanceConcurrency limit).
        // completeJob/failJob also call findOneAndUpdate, so count only acquire calls
        // (filter contains status: 'pending').
        const acquireCalls = spy.mock.calls.filter(
          (args) => args[0]["status"] === JobStatus.PENDING,
        );

        expect(acquireCalls).toHaveLength(2);
      }),
    );
    it.effect("should stop claiming after an empty result even with high concurrency", () =>
      Effect.gen(function* effectWorkflow19() {
        processor = yield* makeProcessor();
        // instanceConcurrency is undefined by default
        expect(ctx.options.instanceConcurrency).toBeUndefined();
        ctx.registerWorker("test-job", createWorker({ concurrency: 100 }));
        vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockResolvedValue(null);
        yield* processor.poll();
        expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalledOnce();
      }),
    );
    it.effect("fills available slots when jobs are waiting", () =>
      Effect.gen(function* effectWorkflow20() {
        processor = yield* makeProcessor();
        const jobs = Array.from({ length: 8 }, () => JobFactoryHelpers.processing());

        const { promise: handlerPromise, resolve: finishHandlers }: PromiseWithResolvers<void> =
          Promise.withResolvers();

        const handler = vi.fn<MockFunction<WorkerRegistration["handler"]>>(async () => {
          await handlerPromise;
        });

        const worker = createWorker({ concurrency: 8, handler });
        ctx.registerWorker("test-job", worker);
        vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockImplementation(
          nativeAsyncMock<Collection["findOneAndUpdate"]>(() => jobs.shift() ?? null),
        );
        const finished = observeJobCompletion(8);
        yield* processor.poll();
        expect({
          handlerMockCallsLength: handler.mock.calls.length,
          workerActiveJobsSize: worker.activeJobs.size,
        }).toStrictEqual({
          handlerMockCallsLength: 8,
          workerActiveJobsSize: 8,
        });
        finishHandlers?.();
        yield* finished;
        expect(worker.activeJobs.size).toBe(0);
      }),
    );
    it.effect("should re-poll when a poll request arrives while already polling", () =>
      Effect.gen(function* effectWorkflow21() {
        processor = yield* makeProcessor();
        ctx.registerWorker("test-job", createWorker({ concurrency: 1 }));
        const acquisition = yield* Deferred.make<null>();
        const acquiring = yield* Deferred.make<Effect.Success<typeof Effect.void>>();
        const runPromise = Effect.runPromiseWith(yield* Effect.context());

        const spy = vi
          .spyOn(ctx.mockCollection, "findOneAndUpdate")
          .mockImplementationOnce(
            async () =>
              await runPromise(
                Deferred.succeed(acquiring, undefined).pipe(
                  Effect.andThen(Deferred.await(acquisition)),
                ),
              ),
          )
          .mockResolvedValue(null);

        // Start first poll (will be held open)
        const polling = yield* Effect.forkChild(processor.poll());
        yield* Deferred.await(acquiring);
        expect(spy).toHaveBeenCalledOnce();

        // While first poll is running, request another poll
        const secondPolling = yield* Effect.forkChild(processor.poll(new Set(["test-job"])), {
          startImmediately: true,
        });

        // The second poll should stay queued until the first poll finishes.
        expect(spy).toHaveBeenCalledOnce();
        // Release the first poll
        yield* Deferred.succeed(acquisition, null);
        yield* Fiber.join(secondPolling);
        yield* Fiber.join(polling);
        // First poll: 1 call. Re-poll (full): 1 call.
        expect(spy).toHaveBeenCalledTimes(2);
      }),
    );
    it.effect.each([false, true])(
      "retains overlapping discovery scope, full requested: %s",
      (full) =>
        Effect.gen(function* effectWorkflow22() {
          processor = yield* makeProcessor();

          for (const name of ["first", "second", "unrelated"]) {
            ctx.registerWorker(name, createWorker());
          }

          const acquisition = yield* Deferred.make<null>();
          const acquiring = yield* Deferred.make<Effect.Success<typeof Effect.void>>();
          const runPromise = Effect.runPromiseWith(yield* Effect.context());

          const claim = vi
            .mocked(ctx.mockCollection.findOneAndUpdate)
            .mockImplementationOnce(
              async () =>
                await runPromise(
                  Deferred.succeed(acquiring, undefined).pipe(
                    Effect.andThen(Deferred.await(acquisition)),
                  ),
                ),
            )
            .mockResolvedValue(null);

          const polling = yield* Effect.forkChild(processor.poll(new Set(["first"])));
          yield* Deferred.await(acquiring);
          expect(claim).toHaveBeenCalledOnce();

          if (full) {
            yield* processor.poll();
          }

          yield* processor.poll(new Set(["second"]));
          yield* Deferred.succeed(acquisition, null);
          yield* Fiber.join(polling);
          expect(claim.mock.calls.map(([filter]) => claimName(filter))).toStrictEqual(
            full ? ["first", "first", "second", "unrelated"] : ["first", "second"],
          );
        }),
    );
    it.effect("bounds overlapping notifications with full discovery, then restores targeting", () =>
      Effect.gen(function* effectWorkflow23() {
        processor = yield* makeProcessor();

        for (const name of ["first", "second", "unrelated"]) {
          ctx.registerWorker(name, createWorker());
        }

        const acquisition = yield* Deferred.make<null>();
        const acquiring = yield* Deferred.make<Effect.Success<typeof Effect.void>>();
        const runPromise = Effect.runPromiseWith(yield* Effect.context());

        const claim = vi
          .mocked(ctx.mockCollection.findOneAndUpdate)
          .mockImplementationOnce(
            async () =>
              await runPromise(
                Deferred.succeed(acquiring, undefined).pipe(
                  Effect.andThen(Deferred.await(acquisition)),
                ),
              ),
          )
          .mockResolvedValue(null);

        const polling = yield* Effect.forkChild(processor.poll(new Set(["first"])));
        yield* Deferred.await(acquiring);
        expect(claim).toHaveBeenCalledOnce();
        yield* processor.poll(
          new Set(["second", ...Array.from({ length: 1024 }, (_, i) => `unregistered-${i}`)]),
        );
        yield* Deferred.succeed(acquisition, null);
        yield* Fiber.join(polling);
        expect({
          mockCollectionAggregateMockCallsLength: ctx.mockCollection.aggregate.mock.calls.length,
          claimMockCallsMapFilterFilterName: claim.mock.calls.map(([filter]) => claimName(filter)),
        }).toStrictEqual({
          mockCollectionAggregateMockCallsLength: 1,
          claimMockCallsMapFilterFilterName: ["first", "first", "second", "unrelated"],
        });
        vi.clearAllMocks();
        yield* processor.poll(new Set(["second"]));
        expect({
          mockCollectionAggregateMockCallsLength: ctx.mockCollection.aggregate.mock.calls.length,
          claimMockCallsMapFilterFilterName: claim.mock.calls.map(([filter]) => claimName(filter)),
        }).toStrictEqual({
          mockCollectionAggregateMockCallsLength: 0,
          claimMockCallsMapFilterFilterName: ["second"],
        });
      }),
    );
  });
  describe("worker execution through poll", () => {
    it.effect("drains only its captured executions and retains a later timed-out execution", () =>
      Effect.gen(function* drainExecutionGenerations() {
        processor = yield* makeProcessor();
        const first = JobFactoryHelpers.processing({ name: "work", claimId: "first" });
        const second = JobFactoryHelpers.processing({ name: "work", claimId: "second" });
        const releaseFirst = Promise.withResolvers<Effect.Success<typeof Effect.void>>();
        const releaseSecond = Promise.withResolvers<Effect.Success<typeof Effect.void>>();
        ctx.admission.register(
          "work",
          async (job) => {
            await (job.claimId === "first" ? releaseFirst.promise : releaseSecond.promise);
          },
          { concurrency: 2 },
        );
        ctx.mockCollection.findOneAndUpdate.mockResolvedValueOnce(first).mockResolvedValue(null);

        try {
          yield* processor.poll(new Set(["work"]));
          const original = processor.captureDrain();
          const stopping = yield* original.await(1000).pipe(Effect.forkChild);
          ctx.admission.stop();
          ctx.admission.start();
          ctx.mockCollection.findOneAndUpdate.mockResolvedValueOnce(second);
          yield* processor.poll(new Set(["work"]));
          releaseFirst.resolve();
          expect({
            drained: yield* Fiber.join(stopping),
            incomplete: original.incompleteJobs(),
          }).toStrictEqual({ drained: true, incomplete: [] });
          const later = processor.captureDrain();
          const laterStop = yield* later.await(1000).pipe(Effect.forkChild);
          yield* TestClock.adjust(1000);
          expect({
            drained: yield* Fiber.join(laterStop),
            incomplete: later.incompleteJobs(),
            slots: ctx.admission.availableSlots("work"),
          }).toStrictEqual({ drained: false, incomplete: [second], slots: 1 });
          const finished = observeJobCompletion();
          releaseSecond.resolve();
          yield* finished;
          expect({
            incomplete: later.incompleteJobs(),
            slots: ctx.admission.availableSlots("work"),
          }).toStrictEqual({ incomplete: [], slots: 2 });
        } finally {
          releaseFirst.resolve();
          releaseSecond.resolve();
        }
      }),
    );

    it.effect("includes payload validation but excludes persistence from job duration", () =>
      Effect.gen(function* effectWorkflow24() {
        processor = yield* makeProcessor();
        const job = JobFactoryHelpers.processing();
        const completedJob = { ...job, status: JobStatus.COMPLETED };

        const validation = Promise.withResolvers<{
          value: unknown;
        }>();

        const handler: PromiseWithResolvers<void> = Promise.withResolvers();
        const persistence: PromiseWithResolvers<void> = Promise.withResolvers();
        const validating = yield* Deferred.make<Effect.Success<typeof Effect.void>>();
        const handling = yield* Deferred.make<Effect.Success<typeof Effect.void>>();
        const persisting = yield* Deferred.make<Effect.Success<typeof Effect.void>>();

        const worker = createWorker({
          handler: async () => {
            Deferred.doneUnsafe(handling, Effect.void);
            {
              await handler.promise;
            }
          },
          schema: {
            "~standard": {
              version: 1,
              vendor: "test",
              validate: async () => {
                Deferred.doneUnsafe(validating, Effect.void);

                return await validation.promise;
              },
            },
          },
        });

        vi.spyOn(ctx.mockCollection, "findOneAndUpdate")
          .mockResolvedValueOnce(job)
          .mockImplementationOnce(async () => {
            Deferred.doneUnsafe(persisting, Effect.void);
            await persistence.promise;

            return completedJob;
          });
        ctx.registerWorker(job.name, worker);
        const finished = observeJobCompletion();

        try {
          yield* processor.poll(new Set([job.name]));
          yield* Deferred.await(validating);
          yield* TestClock.adjust(50);
          validation.resolve({ value: job.data });
          yield* Deferred.await(handling);
          yield* TestClock.adjust(125);
          handler.resolve();
          yield* Deferred.await(persisting);
          yield* TestClock.adjust(200);
          persistence.resolve();
          yield* finished;
          expect(ctx.emit).toHaveBeenCalledWith("job:complete", {
            job: completedJob,
            duration: 175,
          });
        } finally {
          validation.resolve({ value: job.data });
          handler.resolve();
          persistence.resolve();
        }
      }),
    );
    it.effect.each([-60_000, 0, 60_000])(
      "measures Promise handler elapsed time when wall time shifts by %i ms",
      (shift) =>
        Effect.gen(function* effectWorkflow25() {
          processor = yield* makeProcessor();
          const testClock = yield* TestClock.testClockWith(Effect.succeed);
          const clock = yield* Clock.Clock;
          let offset = 0;
          yield* Effect.gen(function* effectWorkflow26() {
            processor = yield* makeProcessor();
            yield* testClock.setTime(10_000);
            const job = JobFactoryHelpers.processing();

            const completedJob = JobFactoryHelpers.completed({
              _id: job._id,
              name: job.name,
              data: job.data,
            });

            const handler: PromiseWithResolvers<void> = Promise.withResolvers();
            const started = yield* Deferred.make<Effect.Success<typeof Effect.void>>();

            const worker = createWorker({
              handler: async () => {
                Deferred.doneUnsafe(started, Effect.void);
                {
                  await handler.promise;
                }
              },
            });

            vi.spyOn(ctx.mockCollection, "findOneAndUpdate")
              .mockResolvedValueOnce(job)
              .mockResolvedValueOnce(completedJob);
            ctx.registerWorker(job.name, worker);
            const finished = observeJobCompletion();
            yield* processor.poll(new Set([job.name]));
            yield* Deferred.await(started);
            offset = shift;
            yield* testClock.adjust(125);
            expect(worker.activeJobs.size).toBe(1);
            expect(ctx.emitHistory).not.toContainEqual(
              objectContainingMatcher({ event: "job:complete" }),
            );
            handler.resolve();
            yield* finished;
            expect(worker.activeJobs.size).toBe(0);
            expect(ctx.emit).toHaveBeenCalledWith("job:complete", {
              job: completedJob,
              duration: 125,
            });
          }).pipe(
            Effect.provideService(
              Clock.Clock,
              clockWithWallTime(
                clock,
                mapEffect(clock.currentTimeMillis, (now) => now + offset),
                () => clock.currentTimeMillisUnsafe() + offset,
              ),
            ),
          );
        }),
    );
    it.effect("should execute handler and emit job:start and job:complete events", () =>
      Effect.gen(function* effectWorkflow27() {
        processor = yield* makeProcessor();
        const job = JobFactoryHelpers.processing();

        const completedJob = JobFactoryHelpers.completed({
          _id: job._id,
          name: job.name,
          data: job.data,
        });

        const handler = vi
          .fn<MockFunction<WorkerRegistration["handler"]>>()
          .mockResolvedValue(undefined);

        const worker = createWorker({ handler });
        vi.spyOn(ctx.mockCollection, "findOneAndUpdate")
          .mockResolvedValueOnce(job)
          .mockResolvedValueOnce(completedJob);
        ctx.registerWorker(job.name, worker);
        const finished = observeJobCompletion();
        yield* processor.poll(new Set([job.name]));
        yield* finished;
        expect(worker.activeJobs.size).toBe(0);
        expect(handler).toHaveBeenCalledWith(job);
        expect(ctx.emitHistory).toContainEqual(objectContainingMatcher({ event: "job:start" }));
        expect(ctx.emitHistory).toContainEqual(objectContainingMatcher({ event: "job:complete" }));
      }),
    );
    it.effect(
      "should emit job:complete with the actual DB document, not the stale in-memory job",
      () =>
        Effect.gen(function* effectWorkflow28() {
          processor = yield* makeProcessor();
          const job = JobFactoryHelpers.processing();

          const completedJob = JobFactoryHelpers.completed({
            _id: job._id,
            name: job.name,
            data: job.data,
          });

          const worker = createWorker();
          vi.spyOn(ctx.mockCollection, "findOneAndUpdate")
            .mockResolvedValueOnce(job)
            .mockResolvedValueOnce(completedJob);
          ctx.registerWorker(job.name, worker);
          const finished = observeJobCompletion();
          yield* processor.poll(new Set([job.name]));
          yield* finished;
          expect(worker.activeJobs.size).toBe(0);
          const completeEvent = ctx.emitHistory.find((e) => e.event === "job:complete");

          const payload = fromAny<
            {
              job: PersistedJob;
              duration: number;
            },
            unknown
          >(completeEvent?.payload);

          expect({
            payloadJobStatus: payload.job.status,
            payloadJob_id: payload.job._id,
          }).toStrictEqual({
            payloadJobStatus: JobStatus.COMPLETED,
            payloadJob_id: job._id,
          });
        }),
    );
    it.effect("should call failJob and emit job:fail on handler error", () =>
      Effect.gen(function* effectWorkflow29() {
        processor = yield* makeProcessor();
        const job = JobFactoryHelpers.processing({ failCount: 0 });

        const failedJob = JobFactoryHelpers.pending({
          _id: job._id,
          name: job.name,
          data: job.data,
          failCount: 1,
          failReason: "Handler failed",
        });

        const worker = createWorker({
          handler: vi
            .fn<MockFunction<WorkerRegistration["handler"]>>()
            .mockRejectedValue(new Error("Handler failed")),
        });

        vi.spyOn(ctx.mockCollection, "findOneAndUpdate")
          .mockResolvedValueOnce(job)
          .mockResolvedValueOnce(failedJob);
        ctx.registerWorker(job.name, worker);
        const finished = observeJobCompletion();
        yield* processor.poll(new Set([job.name]));
        yield* finished;
        expect(worker.activeJobs.size).toBe(0);
        expect(ctx.emitHistory).toContainEqual(objectContainingMatcher({ event: "job:fail" }));
        const failEvent = ctx.emitHistory.find((e) => e.event === "job:fail");
        expect(
          fromAny<
            {
              error: Error;
            },
            unknown
          >(failEvent?.payload)?.error?.message,
        ).toBe("Handler failed");
      }),
    );
    it.effect("should coerce non-Error thrown values to Error objects", () =>
      Effect.gen(function* effectWorkflow30() {
        processor = yield* makeProcessor();
        const job = JobFactoryHelpers.processing({ failCount: 0 });

        const failedJob = JobFactoryHelpers.pending({
          _id: job._id,
          name: job.name,
          data: job.data,
          failCount: 1,
          failReason: "String error message",
        });

        const worker = createWorker({
          handler: vi
            .fn<MockFunction<WorkerRegistration["handler"]>>()
            .mockRejectedValue("String error message"),
        });

        vi.spyOn(ctx.mockCollection, "findOneAndUpdate")
          .mockResolvedValueOnce(job)
          .mockResolvedValueOnce(failedJob);
        ctx.registerWorker(job.name, worker);
        const finished = observeJobCompletion();
        yield* processor.poll(new Set([job.name]));
        yield* finished;
        expect(worker.activeJobs.size).toBe(0);
        expect(ctx.emitHistory).toContainEqual(objectContainingMatcher({ event: "job:fail" }));
        const failEvent = ctx.emitHistory.find((e) => e.event === "job:fail");

        const payload = fromAny<
          {
            error: Error;
          },
          unknown
        >(failEvent?.payload);

        expect(payload.error).toBeInstanceOf(Error);
        expect(payload.error.message).toBe("String error message");
      }),
    );
    it.effect("should track job in activeJobs during processing and remove after", () =>
      Effect.gen(function* effectWorkflow31() {
        processor = yield* makeProcessor();
        const job = JobFactoryHelpers.processing();

        const completedJob = JobFactoryHelpers.completed({
          _id: job._id,
          name: job.name,
          data: job.data,
        });

        const worker = createWorker();
        vi.spyOn(ctx.mockCollection, "findOneAndUpdate")
          .mockResolvedValueOnce(job)
          .mockResolvedValueOnce(completedJob);
        ctx.registerWorker(job.name, worker);
        const finished = observeJobCompletion();
        yield* processor.poll(new Set([job.name]));
        yield* finished;
        expect({
          workerActiveJobsSize: worker.activeJobs.size,
          workerActiveJobsSize2: worker.activeJobs.size,
        }).toStrictEqual({
          workerActiveJobsSize: 0,
          workerActiveJobsSize2: 0,
        });
      }),
    );
    it.effect("should not emit job:complete when completeJob returns null (race condition)", () =>
      Effect.gen(function* effectWorkflow32() {
        processor = yield* makeProcessor();
        const job = JobFactoryHelpers.processing();
        const worker = createWorker();
        // completeJob returns null (job was deleted or status changed concurrently)
        vi.spyOn(ctx.mockCollection, "findOneAndUpdate")
          .mockResolvedValueOnce(job)
          .mockResolvedValueOnce(null);
        ctx.registerWorker(job.name, worker);
        const finished = observeJobCompletion();
        yield* processor.poll(new Set([job.name]));
        yield* finished;
        expect(worker.activeJobs.size).toBe(0);
        expect(ctx.emitHistory).toContainEqual(objectContainingMatcher({ event: "job:start" }));
        expect(ctx.emitHistory).not.toContainEqual(
          objectContainingMatcher({ event: "job:complete" }),
        );
      }),
    );
    it.effect("should not emit job:fail when failJob returns null (race condition)", () =>
      Effect.gen(function* effectWorkflow33() {
        processor = yield* makeProcessor();
        const job = JobFactoryHelpers.processing({ failCount: 0 });

        const worker = createWorker({
          handler: vi
            .fn<MockFunction<WorkerRegistration["handler"]>>()
            .mockRejectedValue(new Error("Handler failed")),
        });

        // failJob returns null (job was deleted or status changed concurrently)
        vi.spyOn(ctx.mockCollection, "findOneAndUpdate")
          .mockResolvedValueOnce(job)
          .mockResolvedValueOnce(null);
        ctx.registerWorker(job.name, worker);
        const finished = observeJobCompletion();
        yield* processor.poll(new Set([job.name]));
        yield* finished;
        expect(worker.activeJobs.size).toBe(0);
        expect(ctx.emitHistory).toContainEqual(objectContainingMatcher({ event: "job:start" }));
        expect(ctx.emitHistory).not.toContainEqual(objectContainingMatcher({ event: "job:fail" }));
      }),
    );
    it.effect(
      "should derive willRetry from actual DB status (PENDING = retry, FAILED = no retry)",
      () =>
        Effect.gen(function* effectWorkflow34() {
          processor = yield* makeProcessor();
          // Case 1: Job will retry (status reset to PENDING)
          const job1 = JobFactoryHelpers.processing({ failCount: 0 });

          const retriedJob = JobFactoryHelpers.pending({
            _id: job1._id,
            name: job1.name,
            data: job1.data,
            failCount: 1,
          });

          const worker1 = createWorker({
            handler: vi
              .fn<MockFunction<WorkerRegistration["handler"]>>()
              .mockRejectedValue(new Error("Fail")),
          });

          vi.spyOn(ctx.mockCollection, "findOneAndUpdate")
            .mockResolvedValueOnce(job1)
            .mockResolvedValueOnce(retriedJob);
          ctx.registerWorker(job1.name, worker1);
          const firstFinished = observeJobCompletion();
          yield* processor.poll(new Set([job1.name]));
          yield* firstFinished;
          expect(worker1.activeJobs.size).toBe(0);
          const retryEvent = ctx.emitHistory.find((e) => e.event === "job:fail");
          expect(
            fromAny<
              {
                willRetry: boolean;
              },
              unknown
            >(retryEvent?.payload)?.willRetry,
          ).toBe(true);
          // Reset for case 2
          ctx.emitHistory.length = 0;
          // Case 2: Job permanently failed (status set to FAILED)
          const job2 = JobFactoryHelpers.processing({ failCount: 2 });

          const permanentlyFailedJob = JobFactoryHelpers.failed({
            _id: job2._id,
            name: job2.name,
            data: job2.data,
            failCount: 3,
          });

          const worker2 = createWorker({
            handler: vi
              .fn<MockFunction<WorkerRegistration["handler"]>>()
              .mockRejectedValue(new Error("Fail")),
          });

          vi.spyOn(ctx.mockCollection, "findOneAndUpdate")
            .mockResolvedValueOnce(job2)
            .mockResolvedValueOnce(permanentlyFailedJob);
          ctx.registerWorker(job2.name, worker2);
          const secondFinished = observeJobCompletion();
          yield* processor.poll(new Set([job2.name]));
          yield* secondFinished;
          expect(worker2.activeJobs.size).toBe(0);
          const failEvent = ctx.emitHistory.find((e) => e.event === "job:fail");
          expect(
            fromAny<
              {
                willRetry: boolean;
              },
              unknown
            >(failEvent?.payload)?.willRetry,
          ).toBe(false);
        }),
    );
    it.effect("should still remove job from activeJobs even when transition returns null", () =>
      Effect.gen(function* effectWorkflow35() {
        processor = yield* makeProcessor();
        const job = JobFactoryHelpers.processing();
        const worker = createWorker();
        vi.spyOn(ctx.mockCollection, "findOneAndUpdate")
          .mockResolvedValueOnce(job)
          .mockResolvedValueOnce(null);
        ctx.registerWorker(job.name, worker);
        const finished = observeJobCompletion();
        yield* processor.poll(new Set([job.name]));
        yield* finished;
        expect({
          workerActiveJobsSize: worker.activeJobs.size,
          workerActiveJobsSize2: worker.activeJobs.size,
        }).toStrictEqual({
          workerActiveJobsSize: 0,
          workerActiveJobsSize2: 0,
        });
      }),
    );
    it.effect("should call notifyJobFinished after successful completion", () =>
      Effect.gen(function* effectWorkflow36() {
        processor = yield* makeProcessor();
        const job = JobFactoryHelpers.processing();

        const completedJob = JobFactoryHelpers.completed({
          _id: job._id,
          name: job.name,
          data: job.data,
        });

        const worker = createWorker();
        vi.spyOn(ctx.mockCollection, "findOneAndUpdate")
          .mockResolvedValueOnce(job)
          .mockResolvedValueOnce(completedJob);
        ctx.registerWorker(job.name, worker);
        const finished = observeJobCompletion();
        yield* processor.poll(new Set([job.name]));
        yield* finished;
        expect({
          workerActiveJobsSize: worker.activeJobs.size,
          notifyJobFinishedMockCallsLength: ctx.notifyJobFinished.mock.calls.length,
        }).toStrictEqual({
          workerActiveJobsSize: 0,
          notifyJobFinishedMockCallsLength: 1,
        });
      }),
    );
    it.effect("should call notifyJobFinished after failure", () =>
      Effect.gen(function* effectWorkflow37() {
        processor = yield* makeProcessor();
        const job = JobFactoryHelpers.processing({ failCount: 0 });

        const failedJob = JobFactoryHelpers.pending({
          _id: job._id,
          name: job.name,
          data: job.data,
          failCount: 1,
          failReason: "Handler failed",
        });

        const worker = createWorker({
          handler: vi
            .fn<MockFunction<WorkerRegistration["handler"]>>()
            .mockRejectedValue(new Error("Handler failed")),
        });

        vi.spyOn(ctx.mockCollection, "findOneAndUpdate")
          .mockResolvedValueOnce(job)
          .mockResolvedValueOnce(failedJob);
        ctx.registerWorker(job.name, worker);
        const finished = observeJobCompletion();
        yield* processor.poll(new Set([job.name]));
        yield* finished;
        expect({
          workerActiveJobsSize: worker.activeJobs.size,
          notifyJobFinishedMockCallsLength: ctx.notifyJobFinished.mock.calls.length,
        }).toStrictEqual({
          workerActiveJobsSize: 0,
          notifyJobFinishedMockCallsLength: 1,
        });
      }),
    );
  });
  describe("instance capacity", () => {
    it.effect("caps acquisitions at instanceConcurrency", () =>
      Effect.gen(function* effectWorkflow41() {
        processor = yield* makeProcessor();
        ctx.options.instanceConcurrency = 2;
        ctx.registerWorker("test-job", createWorker({ concurrency: 10 }));
        const job1 = JobFactory.build({ name: "test-job" });
        const job2 = JobFactory.build({ name: "test-job" });

        const spy = vi
          .spyOn(ctx.mockCollection, "findOneAndUpdate")
          .mockResolvedValueOnce(job1)
          .mockResolvedValueOnce(job2)
          .mockResolvedValue(null);

        yield* processor.poll();

        const acquireCalls = spy.mock.calls.filter(
          (args) => args[0]["status"] === JobStatus.PENDING,
        );

        // The instance budget permits two claims across this worker.
        expect(acquireCalls).toHaveLength(2);
      }),
    );
  });
});
