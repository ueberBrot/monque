import { it } from "@effect/vitest";
import { fromAny, fromPartial } from "@total-typescript/shoehorn";
/**
 * Unit tests for JobProcessor service.
 *
 * Tests job polling, acquisition, processing, completion, and failure handling.
 * Uses mock SchedulerContext to test processing logic in isolation.
 */
import { Clock, Deferred, Effect, Fiber } from "effect";
import { map as mapEffect } from "effect/Effect";
import { isString } from "effect/Predicate";
import { TestClock } from "effect/testing";
import type { FindCursor, Filter, Document, Collection } from "mongodb";
import { ReadConcern } from "mongodb";
import { afterEach, beforeEach, describe, expect, vi } from "vite-plus/test";

import { JobStatus } from "@/jobs";
import type { PersistedJob } from "@/jobs";
import { JobLifecycle } from "@/scheduler/services/job-lifecycle.js";
import { JobProcessor } from "@/scheduler/services/job-processor.js";
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
  let processor: JobProcessor;
  beforeEach(() => {
    ctx = createMockContext();
    // Discovery may race another instance's claims; acquisition fixtures remain authoritative.
    vi.mocked(ctx.mockCollection.aggregate).mockImplementation(() =>
      fromAny<ReturnType<typeof ctx.mockCollection.aggregate>, unknown>({
        toArray: nativeAsyncMock<FindCursor["toArray"]>(() =>
          [...ctx.workers.keys()].map((name) => ({ _id: name, nextRunAt: new Date(0) })),
        ),
      }),
    );
    processor = new JobProcessor(ctx);
  });
  afterEach(() => {
    vi.clearAllMocks();
  });
  describe("poll", () => {
    it.effect("discovers an idle collection once without probing every registered name", () =>
      Effect.gen(function* effectWorkflow1() {
        for (let i = 0; i < 100; i += 1) {
          ctx.workers.set(`worker-${i}`, createWorker());
        }
        vi.mocked(ctx.mockCollection.aggregate).mockReturnValue(
          fromPartial<ReturnType<typeof ctx.mockCollection.aggregate>>({
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
        ctx.workers.set("work", createWorker());
        const runAt = new Date(Date.now() + 5000);
        vi.mocked(ctx.mockCollection.aggregate).mockReturnValue(
          fromPartial<ReturnType<typeof ctx.mockCollection.aggregate>>({
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
          for (const name of ["work", "unrelated"]) {
            ctx.workers.set(name, createWorker());
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
          ctx.workers.set("work", createWorker());
          const staleJob = { _id: "work", nextRunAt: new Date(0) };
          vi.mocked(ctx.mockCollection.aggregate).mockImplementation((_pipeline, options) =>
            fromAny<ReturnType<typeof ctx.mockCollection.aggregate>, unknown>({
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
        ctx.workers.set("work", createWorker());
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
        ctx.workers.set("work", createWorker());
        const error = new Error("Read unavailable");
        vi.mocked(ctx.mockCollection.aggregate).mockReturnValue(
          fromPartial<ReturnType<typeof ctx.mockCollection.aggregate>>({
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
          ctx.workers.set("work", createWorker());
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
          for (const name of ["email", "unrelated"]) {
            ctx.workers.set(name, createWorker());
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
          const job = JobFactoryHelpers.processing({ name: "EMAIL" });
          ctx.workers.set(
            "EMAIL",
            createWorker({ activeJobs: new Map([[job._id.toHexString(), job]]) }),
          );
          ctx.workers.set("email", createWorker());
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
        ctx.workers.set("work", createWorker());
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
          vi.mocked(ctx.isRunning).mockReturnValue(false);
        } else {
          vi.mocked(ctx.isPaused).mockReturnValue(true);
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
          const lifecycle = new JobLifecycle(ctx);
          processor = new JobProcessor(ctx, lifecycle);
          const acquisition = yield* Deferred.make<PersistedJob | null>();
          const acquiring = yield* Deferred.make<Effect.Success<typeof Effect.void>>();
          const claimed = JobFactoryHelpers.processing({ name: "work" });
          const handler = vi
            .fn<MockFunction<WorkerRegistration["handler"]>>()
            .mockResolvedValue(undefined);
          ctx.workers.set("work", createWorker({ handler }));
          const claim = vi
            .spyOn(lifecycle, "claimNext")
            .mockReturnValueOnce(
              Deferred.succeed(acquiring, undefined).pipe(
                Effect.andThen(Deferred.await(acquisition)),
              ),
            );
          const release = vi.spyOn(lifecycle, "releaseOwnedClaim").mockReturnValue(Effect.void);
          if (releaseFails) {
            release.mockReturnValue(Effect.fail(releaseError));
          }
          const polling = yield* Effect.forkChild(processor.poll());
          yield* Deferred.await(acquiring);
          expect(vi.mocked(claim).mock.calls.length).toBeGreaterThan(0);
          vi.mocked(ctx.isPaused).mockReturnValue(true);
          yield* Deferred.succeed(acquisition, claimed);
          yield* Fiber.join(polling);
          expect(handler).not.toHaveBeenCalled();
          expect(release).toHaveBeenCalledExactlyOnceWith(claimed);
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
        ctx.options.instanceConcurrency = 1;
        const first = JobFactoryHelpers.processing({ name: "test-job" });
        const next = JobFactoryHelpers.processing({ name: "test-job" });
        const handler = vi
          .fn<MockFunction<WorkerRegistration["handler"]>>()
          .mockResolvedValue(undefined);
        const worker = createWorker({ handler });
        ctx.workers.set("test-job", worker);
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
    it.effect("should not poll if scheduler is not running", () =>
      Effect.gen(function* effectWorkflow13() {
        vi.spyOn(ctx, "isRunning").mockReturnValue(false);
        yield* processor.poll();
        expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
      }),
    );
    it.effect("should poll for each registered worker with available capacity", () =>
      Effect.gen(function* effectWorkflow14() {
        ctx.workers.set("test-job", createWorker({ concurrency: 2 }));
        vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockResolvedValue(null);
        yield* processor.poll();
        expect(vi.mocked(ctx.mockCollection.findOneAndUpdate).mock.calls.length).toBeGreaterThan(0);
      }),
    );
    it.effect("should skip workers at max concurrency", () =>
      Effect.gen(function* effectWorkflow15() {
        const job = JobFactory.build();
        ctx.workers.set(
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
        ctx.options.instanceConcurrency = 2;
        const job1 = JobFactory.build({ name: "worker-1" });
        const job2 = JobFactory.build({ name: "worker-2" });
        const { promise: handlerPromise, resolve: resolveHandlers }: PromiseWithResolvers<void> =
          Promise.withResolvers();
        const handler = async () => {
          await handlerPromise;
        };
        ctx.workers.set("worker-1", createWorker({ concurrency: 5, handler }));
        ctx.workers.set("worker-2", createWorker({ concurrency: 5, handler }));
        // Seed the counter by acquiring 2 jobs through a first poll
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
        ctx.options.instanceConcurrency = 3;
        const seedJob = JobFactory.build({ name: "worker-1" });
        const newJob = JobFactory.build({ name: "worker-2" });
        ctx.workers.set("worker-1", createWorker({ concurrency: 5 }));
        ctx.workers.set("worker-2", createWorker({ concurrency: 5 }));
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
        ctx.options.instanceConcurrency = 2;
        const newJob1 = JobFactory.build({ name: "test-job" });
        const newJob2 = JobFactory.build({ name: "test-job" });
        ctx.workers.set("test-job", createWorker({ concurrency: 10 }));
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
        // instanceConcurrency is undefined by default
        expect(ctx.options.instanceConcurrency).toBeUndefined();
        ctx.workers.set("test-job", createWorker({ concurrency: 100 }));
        vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockResolvedValue(null);
        yield* processor.poll();
        expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalledOnce();
      }),
    );
    it.effect("fills available slots when jobs are waiting", () =>
      Effect.gen(function* effectWorkflow20() {
        const jobs = Array.from({ length: 8 }, () => JobFactoryHelpers.processing());
        const { promise: handlerPromise, resolve: finishHandlers }: PromiseWithResolvers<void> =
          Promise.withResolvers();
        const handler = vi.fn<MockFunction<WorkerRegistration["handler"]>>(async () => {
          await handlerPromise;
        });
        const worker = createWorker({ concurrency: 8, handler });
        ctx.workers.set("test-job", worker);
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
        ctx.workers.set("test-job", createWorker({ concurrency: 1 }));
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
          for (const name of ["first", "second", "unrelated"]) {
            ctx.workers.set(name, createWorker());
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
        for (const name of ["first", "second", "unrelated"]) {
          ctx.workers.set(name, createWorker());
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
    it.effect("includes payload validation but excludes persistence from job duration", () =>
      Effect.gen(function* effectWorkflow24() {
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
        });
        worker.schema = {
          "~standard": {
            version: 1,
            vendor: "test",
            validate: async () => {
              Deferred.doneUnsafe(validating, Effect.void);
              return await validation.promise;
            },
          },
        };
        vi.spyOn(ctx.mockCollection, "findOneAndUpdate")
          .mockResolvedValueOnce(job)
          .mockImplementationOnce(async () => {
            Deferred.doneUnsafe(persisting, Effect.void);
            await persistence.promise;
            return completedJob;
          });
        ctx.workers.set(job.name, worker);
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
          const testClock = yield* TestClock.testClockWith(Effect.succeed);
          const clock = yield* Clock.Clock;
          let offset = 0;
          yield* Effect.gen(function* effectWorkflow26() {
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
            ctx.workers.set(job.name, worker);
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
        ctx.workers.set(job.name, worker);
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
          ctx.workers.set(job.name, worker);
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
        ctx.workers.set(job.name, worker);
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
        ctx.workers.set(job.name, worker);
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
        ctx.workers.set(job.name, worker);
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
        const job = JobFactoryHelpers.processing();
        const worker = createWorker();
        // completeJob returns null (job was deleted or status changed concurrently)
        vi.spyOn(ctx.mockCollection, "findOneAndUpdate")
          .mockResolvedValueOnce(job)
          .mockResolvedValueOnce(null);
        ctx.workers.set(job.name, worker);
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
        ctx.workers.set(job.name, worker);
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
          ctx.workers.set(job1.name, worker1);
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
          ctx.workers.set(job2.name, worker2);
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
        const job = JobFactoryHelpers.processing();
        const worker = createWorker();
        vi.spyOn(ctx.mockCollection, "findOneAndUpdate")
          .mockResolvedValueOnce(job)
          .mockResolvedValueOnce(null);
        ctx.workers.set(job.name, worker);
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
        ctx.workers.set(job.name, worker);
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
        ctx.workers.set(job.name, worker);
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
  describe("_totalActiveJobs counter", () => {
    it.effect(
      "should increment counter when job is acquired via poll and decrement after completion",
      () =>
        Effect.gen(function* effectWorkflow38() {
          const acquiredJob = JobFactory.build({ name: "test-job" });
          const completedJob = JobFactoryHelpers.completed({
            _id: acquiredJob._id,
            name: acquiredJob.name,
            data: acquiredJob.data,
          });
          ctx.workers.set("test-job", createWorker({ concurrency: 3 }));
          vi.spyOn(ctx.mockCollection, "findOneAndUpdate")
            // acquireJob succeeds
            .mockResolvedValueOnce(acquiredJob)
            // second acquireJob returns null (no more jobs)
            .mockResolvedValueOnce(null)
            // completeJob succeeds
            .mockResolvedValueOnce(completedJob);
          const finished = observeJobCompletion();
          yield* processor.poll();
          yield* finished;
          const worker = ctx.workers.get("test-job");
          expect(worker?.activeJobs.size).toBe(0);
        }),
    );
    it.effect("should decrement counter even when processJob handler fails", () =>
      Effect.gen(function* effectWorkflow39() {
        const acquiredJob = JobFactory.build({ name: "test-job" });
        const failedJob = JobFactoryHelpers.failed({
          _id: acquiredJob._id,
          name: acquiredJob.name,
          data: acquiredJob.data,
          failCount: 3,
        });
        ctx.workers.set(
          "test-job",
          createWorker({
            concurrency: 3,
            handler: vi
              .fn<MockFunction<WorkerRegistration["handler"]>>()
              .mockRejectedValue(new Error("boom")),
          }),
        );
        vi.spyOn(ctx.mockCollection, "findOneAndUpdate")
          // acquireJob
          .mockResolvedValueOnce(acquiredJob)
          // second acquire: no more
          .mockResolvedValueOnce(null)
          // failJob DB write
          .mockResolvedValueOnce(failedJob);
        const finished = observeJobCompletion();
        yield* processor.poll();
        yield* finished;
        const worker = ctx.workers.get("test-job");
        expect(worker?.activeJobs.size).toBe(0);
      }),
    );
    it.effect(
      "should decrement counter even when DB transition returns null (race condition)",
      () =>
        Effect.gen(function* effectWorkflow40() {
          const acquiredJob = JobFactory.build({ name: "test-job" });
          ctx.workers.set("test-job", createWorker({ concurrency: 3 }));
          vi.spyOn(ctx.mockCollection, "findOneAndUpdate")
            // acquireJob
            .mockResolvedValueOnce(acquiredJob)
            // second acquire: no more
            .mockResolvedValueOnce(null)
            // completeJob: race condition null
            .mockResolvedValueOnce(null);
          const finished = observeJobCompletion();
          yield* processor.poll();
          yield* finished;
          const worker = ctx.workers.get("test-job");
          expect(worker?.activeJobs.size).toBe(0);
        }),
    );
    it.effect("should cap poll acquisitions at instanceConcurrency using the O(1) counter", () =>
      Effect.gen(function* effectWorkflow41() {
        ctx.options.instanceConcurrency = 2;
        ctx.workers.set("test-job", createWorker({ concurrency: 10 }));
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
        // counter enforces the limit: exactly 2 acquired (= instanceConcurrency)
        expect(acquireCalls).toHaveLength(2);
      }),
    );
  });
});
