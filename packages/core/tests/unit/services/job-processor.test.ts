import { it } from "@effect/vitest";
/**
 * Unit tests for JobProcessor service.
 *
 * Tests job polling, acquisition, processing, completion, and failure handling.
 * Uses mock SchedulerContext to test processing logic in isolation.
 */
import { Clock, Deferred, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { ReadConcern } from "mongodb";
import { afterEach, beforeEach, describe, expect, vi } from "vite-plus/test";

import { JobStatus, type PersistedJob } from "@/jobs";
import { JobLifecycle } from "@/scheduler/services/job-lifecycle.js";
import { JobProcessor } from "@/scheduler/services/job-processor.js";
import { createMockContext, createWorker, JobFactory, JobFactoryHelpers } from "@tests/factories";

describe("JobProcessor", () => {
  let ctx: ReturnType<typeof createMockContext>;
  let processor: JobProcessor;

  beforeEach(() => {
    ctx = createMockContext();
    // Discovery may race another instance's claims; acquisition fixtures remain authoritative.
    vi.mocked(ctx.mockCollection.aggregate).mockImplementation(
      () =>
        ({
          toArray: vi.fn(async () =>
            [...ctx.workers.keys()].map((name) => ({ _id: name, nextRunAt: new Date(0) })),
          ),
        }) as unknown as ReturnType<typeof ctx.mockCollection.aggregate>,
    );
    processor = new JobProcessor(ctx);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function observeJobCompletion(count = 1) {
    const finished = Deferred.makeUnsafe<void>();
    let remaining = count;
    vi.mocked(ctx.notifyJobFinished).mockImplementation(() => {
      remaining--;
      if (remaining === 0) Deferred.doneUnsafe(finished, Effect.void);
    });
    return Deferred.await(finished);
  }

  describe("poll", () => {
    it.effect("discovers an idle collection once without probing every registered name", () =>
      Effect.gen(function* () {
        for (let i = 0; i < 100; i++) {
          ctx.workers.set(`worker-${i}`, createWorker());
        }
        vi.mocked(ctx.mockCollection.aggregate).mockReturnValue({
          toArray: vi.fn().mockResolvedValue([]),
        } as unknown as ReturnType<typeof ctx.mockCollection.aggregate>);

        yield* processor.poll();

        expect(ctx.mockCollection.aggregate).toHaveBeenCalledOnce();
        expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
      }),
    );

    it.effect("arms persisted future deadlines without trying to claim them early", () =>
      Effect.gen(function* () {
        ctx.workers.set("work", createWorker());
        const runAt = new Date(Date.now() + 5000);
        vi.mocked(ctx.mockCollection.aggregate).mockReturnValue({
          toArray: vi.fn().mockResolvedValue([{ _id: "work", nextRunAt: runAt }]),
        } as unknown as ReturnType<typeof ctx.mockCollection.aggregate>);

        yield* processor.poll();

        expect(ctx.notifyPendingJob).toHaveBeenCalledExactlyOnceWith("work", runAt);
        expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
      }),
    );

    it.effect.each([undefined, "simple"])(
      "keeps binary notifications targeted without a preliminary discovery read, locale: %s",
      (locale) =>
        Effect.gen(function* () {
          for (const name of ["work", "unrelated"]) ctx.workers.set(name, createWorker());
          vi.mocked(ctx.mockCollection.options).mockResolvedValue(
            locale ? { collation: { locale } } : {},
          );
          const claim = vi.mocked(ctx.mockCollection.findOneAndUpdate).mockResolvedValue(null);

          yield* processor.poll(new Set(["work"]));
          yield* processor.poll(new Set(["work"]));

          expect(ctx.mockCollection.aggregate).not.toHaveBeenCalled();
          expect(ctx.mockCollection.options).toHaveBeenCalledOnce();
          expect(claim.mock.calls.map(([filter]) => filter["name"])).toEqual(["work", "work"]);
        }),
    );

    it.effect.each([false, true])(
      "does not retry jobs already claimed on the primary, targeted poll: %s",
      (targeted) =>
        Effect.gen(function* () {
          ctx.workers.set("work", createWorker());
          const staleJob = { _id: "work", nextRunAt: new Date(0) };
          vi.mocked(ctx.mockCollection.aggregate).mockImplementation(
            (_pipeline, options) =>
              ({
                toArray: vi.fn(async () =>
                  options?.readPreference === "primary" &&
                  ReadConcern.fromOptions(options)?.level === "local"
                    ? []
                    : [staleJob],
                ),
              }) as unknown as ReturnType<typeof ctx.mockCollection.aggregate>,
          );
          vi.mocked(ctx.mockCollection.findOneAndUpdate).mockResolvedValue(null);
          vi.mocked(ctx.mockCollection.findOne).mockImplementation(async (_filter, options) =>
            options?.readPreference === "primary" &&
            ReadConcern.fromOptions(options)?.level === "local"
              ? null
              : staleJob,
          );

          yield* processor.poll(targeted ? new Set(["work"]) : undefined);

          expect(ctx.notifyPendingJob).not.toHaveBeenCalled();
          expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalledTimes(targeted ? 1 : 0);
        }),
    );

    it.effect("does not turn failed claims into immediate retry notifications", () =>
      Effect.gen(function* () {
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
      Effect.gen(function* () {
        ctx.workers.set("work", createWorker());
        const error = new Error("Read unavailable");
        vi.mocked(ctx.mockCollection.aggregate).mockReturnValue({
          toArray: vi.fn().mockRejectedValue(error),
        } as unknown as ReturnType<typeof ctx.mockCollection.aggregate>);
        vi.mocked(ctx.mockCollection.findOneAndUpdate).mockResolvedValue(null);

        yield* processor.poll();

        expect(ctx.emit).toHaveBeenCalledWith("job:error", { error });
        expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalledOnce();
      }),
    );

    it.effect.each(["collation", "metadata unavailable"])(
      "keeps atomic discovery when indexed discovery is unsafe: %s",
      (reason) =>
        Effect.gen(function* () {
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

          expect(metadata).toHaveBeenCalledOnce();
          expect(ctx.mockCollection.aggregate).not.toHaveBeenCalled();
          expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalledTimes(2);
          expect(ctx.emitHistory.filter(({ event }) => event === "job:error")).toHaveLength(
            reason === "collation" ? 0 : 1,
          );
        }),
    );

    it.effect.each(["collation", "metadata unavailable"])(
      "discovers registered names from case-variant notifications with %s",
      (reason) =>
        Effect.gen(function* () {
          for (const name of ["email", "unrelated"]) ctx.workers.set(name, createWorker());
          const metadata = vi.mocked(ctx.mockCollection.options);
          if (reason === "collation") {
            metadata.mockResolvedValue({ collation: { locale: "en", strength: 2 } });
          } else {
            metadata.mockRejectedValue(new Error("Collection metadata access denied"));
          }
          const claim = vi.mocked(ctx.mockCollection.findOneAndUpdate).mockResolvedValue(null);

          yield* processor.poll(new Set(["EMAIL"]));
          yield* processor.poll(new Set(["EMAIL"]));

          expect(claim.mock.calls.map(([filter]) => filter["name"])).toEqual([
            "email",
            "unrelated",
            "email",
            "unrelated",
          ]);
          expect(ctx.mockCollection.aggregate).not.toHaveBeenCalled();
          expect(metadata).toHaveBeenCalledOnce();
          expect(ctx.emitHistory.filter(({ event }) => event === "job:error")).toHaveLength(
            reason === "collation" ? 0 : 1,
          );
        }),
    );

    it.effect(
      "uses an available collation-equivalent worker when the notified worker is full",
      () =>
        Effect.gen(function* () {
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

          expect(claim.mock.calls.map(([filter]) => filter["name"])).toEqual(["email"]);
        }),
    );

    it.effect.each(["stop", "pause"])("does not claim after %s during discovery", (action) =>
      Effect.gen(function* () {
        ctx.workers.set("work", createWorker());
        const discovery = yield* Deferred.make<Array<{ _id: string; nextRunAt: Date }>>();
        const discovering = yield* Deferred.make<void>();
        const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
        vi.mocked(ctx.mockCollection.aggregate).mockReturnValue({
          toArray: vi.fn(() =>
            runPromise(
              Deferred.succeed(discovering, undefined).pipe(
                Effect.andThen(Deferred.await(discovery)),
              ),
            ),
          ),
        } as unknown as ReturnType<typeof ctx.mockCollection.aggregate>);
        const polling = yield* Effect.forkChild(processor.poll());
        yield* Deferred.await(discovering);
        if (action === "stop") vi.mocked(ctx.isRunning).mockReturnValue(false);
        else vi.mocked(ctx.isPaused).mockReturnValue(true);
        yield* Deferred.succeed(discovery, [{ _id: "work", nextRunAt: new Date(0) }]);
        yield* Fiber.join(polling);
        expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
      }),
    );

    it.effect.each([false, true])(
      "does not invoke a handler if paused during acquisition (release fails: %s)",
      (releaseFails) => {
        const releaseError = new Error("Release failed");
        return Effect.gen(function* () {
          const lifecycle = new JobLifecycle(ctx);
          processor = new JobProcessor(ctx, lifecycle);
          const acquisition = yield* Deferred.make<PersistedJob | null>();
          const acquiring = yield* Deferred.make<void>();
          const claimed = JobFactoryHelpers.processing({ name: "work" });
          const handler = vi.fn(async () => {});
          ctx.workers.set("work", createWorker({ handler }));
          const claim = vi
            .spyOn(lifecycle, "claimNext")
            .mockReturnValueOnce(
              Deferred.succeed(acquiring, undefined).pipe(
                Effect.andThen(Deferred.await(acquisition)),
              ),
            );
          const release = vi.spyOn(lifecycle, "releaseOwnedClaim").mockReturnValue(Effect.void);
          if (releaseFails) release.mockReturnValue(Effect.fail(releaseError));
          const polling = yield* Effect.forkChild(processor.poll());
          yield* Deferred.await(acquiring);
          expect(claim).toHaveBeenCalled();
          vi.mocked(ctx.isPaused).mockReturnValue(true);
          yield* Deferred.succeed(acquisition, claimed);
          yield* Fiber.join(polling);
          expect(handler).not.toHaveBeenCalled();
          expect(release).toHaveBeenCalledExactlyOnceWith(claimed);
          if (releaseFails) {
            expect(ctx.emit).toHaveBeenCalledWith("job:error", {
              error: expect.objectContaining({ message: "Release failed" }),
              job: claimed,
            });
          }
        });
      },
    );

    it.effect("continues processing after a job:start listener throws with one global slot", () =>
      Effect.gen(function* () {
        ctx.options.instanceConcurrency = 1;
        const first = JobFactoryHelpers.processing({ name: "test-job" });
        const next = JobFactoryHelpers.processing({ name: "test-job" });
        const handler = vi.fn().mockResolvedValue(undefined);
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
        vi.spyOn(ctx.collection, "findOneAndUpdate")
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
        expect(worker.activeJobs.size).toBe(0);
        expect(ctx.notifyJobFinished).toHaveBeenCalledTimes(2);
      }),
    );

    it.effect("should not poll if scheduler is not running", () =>
      Effect.gen(function* () {
        vi.spyOn(ctx, "isRunning").mockReturnValue(false);

        yield* processor.poll();

        expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
      }),
    );

    it.effect("should poll for each registered worker with available capacity", () =>
      Effect.gen(function* () {
        ctx.workers.set("test-job", createWorker({ concurrency: 2 }));

        vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockResolvedValue(null);

        yield* processor.poll();

        expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalled();
      }),
    );

    it.effect("should skip workers at max concurrency", () =>
      Effect.gen(function* () {
        const job = JobFactory.build();
        ctx.workers.set(
          "test-job",
          createWorker({
            concurrency: 1,
            activeJobs: new Map<string, PersistedJob>([["job-1", job]]),
          }),
        );

        yield* processor.poll();

        expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
        expect(ctx.mockCollection.options).not.toHaveBeenCalled();
        expect(ctx.mockCollection.aggregate).not.toHaveBeenCalled();
      }),
    );

    it.effect("should exit early when instanceConcurrency is reached", () =>
      Effect.gen(function* () {
        ctx.options.instanceConcurrency = 2;

        const job1 = JobFactory.build({ name: "worker-1" });
        const job2 = JobFactory.build({ name: "worker-2" });

        let resolveHandlers: (() => void) | undefined;
        const handlerPromise = new Promise<void>((r) => {
          resolveHandlers = r;
        });
        const handler = () => handlerPromise;

        ctx.workers.set("worker-1", createWorker({ concurrency: 5, handler }));
        ctx.workers.set("worker-2", createWorker({ concurrency: 5, handler }));

        // Seed the counter by acquiring 2 jobs through a first poll
        vi.spyOn(ctx.mockCollection, "findOneAndUpdate")
          .mockResolvedValueOnce(job1)
          .mockResolvedValueOnce(job2)
          .mockResolvedValue(null);

        const finished = observeJobCompletion(2);
        yield* processor.poll();

        const callsAfterFirstPoll = (
          ctx.mockCollection.findOneAndUpdate as ReturnType<typeof vi.fn>
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
      Effect.gen(function* () {
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
        expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalled();
      }),
    );

    it.effect("should stop acquiring jobs when global limit is reached mid-poll", () =>
      Effect.gen(function* () {
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
          (args) =>
            typeof args[0] === "object" &&
            args[0] !== null &&
            "status" in args[0] &&
            args[0]["status"] === JobStatus.PENDING,
        );
        expect(acquireCalls).toHaveLength(2);
      }),
    );

    it.effect("should stop claiming after an empty result even with high concurrency", () =>
      Effect.gen(function* () {
        // instanceConcurrency is undefined by default
        expect(ctx.options.instanceConcurrency).toBeUndefined();

        ctx.workers.set("test-job", createWorker({ concurrency: 100 }));

        vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockResolvedValue(null);

        yield* processor.poll();

        expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalledOnce();
      }),
    );

    it.effect("fills available slots when jobs are waiting", () =>
      Effect.gen(function* () {
        const jobs = Array.from({ length: 8 }, () => JobFactoryHelpers.processing());
        let finishHandlers: (() => void) | undefined;
        const handlerPromise = new Promise<void>((resolve) => {
          finishHandlers = resolve;
        });
        const handler = vi.fn(() => handlerPromise);
        const worker = createWorker({ concurrency: 8, handler });
        ctx.workers.set("test-job", worker);
        vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockImplementation(
          async () => jobs.shift() ?? null,
        );

        const finished = observeJobCompletion(8);
        yield* processor.poll();

        expect(handler).toHaveBeenCalledTimes(8);
        expect(worker.activeJobs.size).toBe(8);
        finishHandlers?.();
        yield* finished;
        expect(worker.activeJobs.size).toBe(0);
      }),
    );

    it.effect("should re-poll when a poll request arrives while already polling", () =>
      Effect.gen(function* () {
        ctx.workers.set("test-job", createWorker({ concurrency: 1 }));

        const acquisition = yield* Deferred.make<null>();
        const acquiring = yield* Deferred.make<void>();
        const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const spy = vi
          .spyOn(ctx.mockCollection, "findOneAndUpdate")
          .mockImplementationOnce(() =>
            runPromise(
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
        expect(spy).toHaveBeenCalledTimes(1);

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
        Effect.gen(function* () {
          for (const name of ["first", "second", "unrelated"]) {
            ctx.workers.set(name, createWorker());
          }
          const acquisition = yield* Deferred.make<null>();
          const acquiring = yield* Deferred.make<void>();
          const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
          const claim = vi
            .mocked(ctx.mockCollection.findOneAndUpdate)
            .mockImplementationOnce(() =>
              runPromise(
                Deferred.succeed(acquiring, undefined).pipe(
                  Effect.andThen(Deferred.await(acquisition)),
                ),
              ),
            )
            .mockResolvedValue(null);

          const polling = yield* Effect.forkChild(processor.poll(new Set(["first"])));
          yield* Deferred.await(acquiring);
          expect(claim).toHaveBeenCalledOnce();
          if (full) yield* processor.poll();
          yield* processor.poll(new Set(["second"]));
          yield* Deferred.succeed(acquisition, null);
          yield* Fiber.join(polling);

          expect(claim.mock.calls.map(([filter]) => filter["name"])).toEqual(
            full ? ["first", "first", "second", "unrelated"] : ["first", "second"],
          );
        }),
    );

    it.effect("bounds overlapping notifications with full discovery, then restores targeting", () =>
      Effect.gen(function* () {
        for (const name of ["first", "second", "unrelated"]) {
          ctx.workers.set(name, createWorker());
        }
        const acquisition = yield* Deferred.make<null>();
        const acquiring = yield* Deferred.make<void>();
        const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
        const claim = vi
          .mocked(ctx.mockCollection.findOneAndUpdate)
          .mockImplementationOnce(() =>
            runPromise(
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

        expect(ctx.mockCollection.aggregate).toHaveBeenCalledOnce();
        expect(claim.mock.calls.map(([filter]) => filter["name"])).toEqual([
          "first",
          "first",
          "second",
          "unrelated",
        ]);

        vi.clearAllMocks();
        yield* processor.poll(new Set(["second"]));
        expect(ctx.mockCollection.aggregate).not.toHaveBeenCalled();
        expect(claim.mock.calls.map(([filter]) => filter["name"])).toEqual(["second"]);
      }),
    );
  });

  describe("worker execution through poll", () => {
    it.effect("includes payload validation but excludes persistence from job duration", () =>
      Effect.gen(function* () {
        const job = JobFactoryHelpers.processing();
        const completedJob = { ...job, status: JobStatus.COMPLETED };
        const validation = Promise.withResolvers<{ value: unknown }>();
        const handler = Promise.withResolvers<void>();
        const persistence = Promise.withResolvers<void>();
        const validating = yield* Deferred.make<void>();
        const handling = yield* Deferred.make<void>();
        const persisting = yield* Deferred.make<void>();
        const worker = createWorker({
          handler: () => {
            Deferred.doneUnsafe(handling, Effect.void);
            return handler.promise;
          },
        });
        worker.schema = {
          "~standard": {
            version: 1,
            vendor: "test",
            validate: () => {
              Deferred.doneUnsafe(validating, Effect.void);
              return validation.promise;
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
        Effect.gen(function* () {
          const clock = yield* Clock.Clock;
          let offset = 0;
          yield* Effect.gen(function* () {
            yield* TestClock.setTime(10_000);
            const job = JobFactoryHelpers.processing();
            const completedJob = JobFactoryHelpers.completed({
              _id: job._id,
              name: job.name,
              data: job.data,
            });
            const handler = Promise.withResolvers<void>();
            const started = yield* Deferred.make<void>();
            const worker = createWorker({
              handler: () => {
                Deferred.doneUnsafe(started, Effect.void);
                return handler.promise;
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
            yield* TestClock.adjust(125);
            expect(worker.activeJobs.size).toBe(1);
            expect(ctx.emitHistory).not.toContainEqual(
              expect.objectContaining({ event: "job:complete" }),
            );

            handler.resolve();
            yield* finished;
            expect(worker.activeJobs.size).toBe(0);
            expect(ctx.emit).toHaveBeenCalledWith("job:complete", {
              job: completedJob,
              duration: 125,
            });
          }).pipe(
            Effect.provideService(Clock.Clock, {
              ...clock,
              currentTimeMillis: Effect.map(clock.currentTimeMillis, (now) => now + offset),
              currentTimeMillisUnsafe: () => clock.currentTimeMillisUnsafe() + offset,
            }),
          );
        }),
    );

    it.effect("should execute handler and emit job:start and job:complete events", () =>
      Effect.gen(function* () {
        const job = JobFactoryHelpers.processing();
        const completedJob = JobFactoryHelpers.completed({
          _id: job._id,
          name: job.name,
          data: job.data,
        });
        const handler = vi.fn().mockResolvedValue(undefined);
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
        expect(ctx.emitHistory).toContainEqual(expect.objectContaining({ event: "job:start" }));
        expect(ctx.emitHistory).toContainEqual(expect.objectContaining({ event: "job:complete" }));
      }),
    );

    it.effect(
      "should emit job:complete with the actual DB document, not the stale in-memory job",
      () =>
        Effect.gen(function* () {
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
          const payload = completeEvent?.payload as { job: PersistedJob; duration: number };
          expect(payload.job.status).toBe(JobStatus.COMPLETED);
          expect(payload.job._id).toEqual(job._id);
        }),
    );

    it.effect("should call failJob and emit job:fail on handler error", () =>
      Effect.gen(function* () {
        const job = JobFactoryHelpers.processing({ failCount: 0 });
        const failedJob = JobFactoryHelpers.pending({
          _id: job._id,
          name: job.name,
          data: job.data,
          failCount: 1,
          failReason: "Handler failed",
        });
        const worker = createWorker({
          handler: vi.fn().mockRejectedValue(new Error("Handler failed")),
        });

        vi.spyOn(ctx.mockCollection, "findOneAndUpdate")
          .mockResolvedValueOnce(job)
          .mockResolvedValueOnce(failedJob);

        ctx.workers.set(job.name, worker);
        const finished = observeJobCompletion();
        yield* processor.poll(new Set([job.name]));
        yield* finished;
        expect(worker.activeJobs.size).toBe(0);

        expect(ctx.emitHistory).toContainEqual(expect.objectContaining({ event: "job:fail" }));
        const failEvent = ctx.emitHistory.find((e) => e.event === "job:fail");
        expect((failEvent?.payload as { error: Error })?.error?.message).toBe("Handler failed");
      }),
    );

    it.effect("should coerce non-Error thrown values to Error objects", () =>
      Effect.gen(function* () {
        const job = JobFactoryHelpers.processing({ failCount: 0 });
        const failedJob = JobFactoryHelpers.pending({
          _id: job._id,
          name: job.name,
          data: job.data,
          failCount: 1,
          failReason: "String error message",
        });
        const worker = createWorker({
          handler: vi.fn().mockRejectedValue("String error message"),
        });

        vi.spyOn(ctx.mockCollection, "findOneAndUpdate")
          .mockResolvedValueOnce(job)
          .mockResolvedValueOnce(failedJob);

        ctx.workers.set(job.name, worker);
        const finished = observeJobCompletion();
        yield* processor.poll(new Set([job.name]));
        yield* finished;
        expect(worker.activeJobs.size).toBe(0);

        expect(ctx.emitHistory).toContainEqual(expect.objectContaining({ event: "job:fail" }));
        const failEvent = ctx.emitHistory.find((e) => e.event === "job:fail");
        const payload = failEvent?.payload as { error: Error };
        expect(payload.error).toBeInstanceOf(Error);
        expect(payload.error.message).toBe("String error message");
      }),
    );

    it.effect("should track job in activeJobs during processing and remove after", () =>
      Effect.gen(function* () {
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

        expect(worker.activeJobs.size).toBe(0);
      }),
    );

    it.effect("should not emit job:complete when completeJob returns null (race condition)", () =>
      Effect.gen(function* () {
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

        expect(ctx.emitHistory).toContainEqual(expect.objectContaining({ event: "job:start" }));
        expect(ctx.emitHistory).not.toContainEqual(
          expect.objectContaining({ event: "job:complete" }),
        );
      }),
    );

    it.effect("should not emit job:fail when failJob returns null (race condition)", () =>
      Effect.gen(function* () {
        const job = JobFactoryHelpers.processing({ failCount: 0 });
        const worker = createWorker({
          handler: vi.fn().mockRejectedValue(new Error("Handler failed")),
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

        expect(ctx.emitHistory).toContainEqual(expect.objectContaining({ event: "job:start" }));
        expect(ctx.emitHistory).not.toContainEqual(expect.objectContaining({ event: "job:fail" }));
      }),
    );

    it.effect(
      "should derive willRetry from actual DB status (PENDING = retry, FAILED = no retry)",
      () =>
        Effect.gen(function* () {
          // Case 1: Job will retry (status reset to PENDING)
          const job1 = JobFactoryHelpers.processing({ failCount: 0 });
          const retriedJob = JobFactoryHelpers.pending({
            _id: job1._id,
            name: job1.name,
            data: job1.data,
            failCount: 1,
          });
          const worker1 = createWorker({
            handler: vi.fn().mockRejectedValue(new Error("Fail")),
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
          expect((retryEvent?.payload as { willRetry: boolean })?.willRetry).toBe(true);

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
            handler: vi.fn().mockRejectedValue(new Error("Fail")),
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
          expect((failEvent?.payload as { willRetry: boolean })?.willRetry).toBe(false);
        }),
    );

    it.effect("should still remove job from activeJobs even when transition returns null", () =>
      Effect.gen(function* () {
        const job = JobFactoryHelpers.processing();
        const worker = createWorker();

        vi.spyOn(ctx.mockCollection, "findOneAndUpdate")
          .mockResolvedValueOnce(job)
          .mockResolvedValueOnce(null);

        ctx.workers.set(job.name, worker);
        const finished = observeJobCompletion();
        yield* processor.poll(new Set([job.name]));
        yield* finished;
        expect(worker.activeJobs.size).toBe(0);

        expect(worker.activeJobs.size).toBe(0);
      }),
    );

    it.effect("should call notifyJobFinished after successful completion", () =>
      Effect.gen(function* () {
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

        expect(ctx.notifyJobFinished).toHaveBeenCalledOnce();
      }),
    );

    it.effect("should call notifyJobFinished after failure", () =>
      Effect.gen(function* () {
        const job = JobFactoryHelpers.processing({ failCount: 0 });
        const failedJob = JobFactoryHelpers.pending({
          _id: job._id,
          name: job.name,
          data: job.data,
          failCount: 1,
          failReason: "Handler failed",
        });
        const worker = createWorker({
          handler: vi.fn().mockRejectedValue(new Error("Handler failed")),
        });

        vi.spyOn(ctx.mockCollection, "findOneAndUpdate")
          .mockResolvedValueOnce(job)
          .mockResolvedValueOnce(failedJob);

        ctx.workers.set(job.name, worker);
        const finished = observeJobCompletion();
        yield* processor.poll(new Set([job.name]));
        yield* finished;
        expect(worker.activeJobs.size).toBe(0);

        expect(ctx.notifyJobFinished).toHaveBeenCalledOnce();
      }),
    );
  });

  describe("_totalActiveJobs counter", () => {
    it.effect(
      "should increment counter when job is acquired via poll and decrement after completion",
      () =>
        Effect.gen(function* () {
          const acquiredJob = JobFactory.build({ name: "test-job" });
          const completedJob = JobFactoryHelpers.completed({
            _id: acquiredJob._id,
            name: acquiredJob.name,
            data: acquiredJob.data,
          });

          ctx.workers.set("test-job", createWorker({ concurrency: 3 }));

          vi.spyOn(ctx.mockCollection, "findOneAndUpdate")
            .mockResolvedValueOnce(acquiredJob) // acquireJob succeeds
            .mockResolvedValueOnce(null) // second acquireJob returns null (no more jobs)
            .mockResolvedValueOnce(completedJob); // completeJob succeeds

          const finished = observeJobCompletion();
          yield* processor.poll();

          yield* finished;

          const worker = ctx.workers.get("test-job");
          expect(worker?.activeJobs.size).toBe(0);
        }),
    );

    it.effect("should decrement counter even when processJob handler fails", () =>
      Effect.gen(function* () {
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
            handler: vi.fn().mockRejectedValue(new Error("boom")),
          }),
        );

        vi.spyOn(ctx.mockCollection, "findOneAndUpdate")
          .mockResolvedValueOnce(acquiredJob) // acquireJob
          .mockResolvedValueOnce(null) // second acquire: no more
          .mockResolvedValueOnce(failedJob); // failJob DB write

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
        Effect.gen(function* () {
          const acquiredJob = JobFactory.build({ name: "test-job" });
          ctx.workers.set("test-job", createWorker({ concurrency: 3 }));

          vi.spyOn(ctx.mockCollection, "findOneAndUpdate")
            .mockResolvedValueOnce(acquiredJob) // acquireJob
            .mockResolvedValueOnce(null) // second acquire: no more
            .mockResolvedValueOnce(null); // completeJob: race condition null

          const finished = observeJobCompletion();
          yield* processor.poll();
          yield* finished;

          const worker = ctx.workers.get("test-job");
          expect(worker?.activeJobs.size).toBe(0);
        }),
    );

    it.effect("should cap poll acquisitions at instanceConcurrency using the O(1) counter", () =>
      Effect.gen(function* () {
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
          (args) =>
            typeof args[0] === "object" &&
            args[0] !== null &&
            "status" in args[0] &&
            args[0]["status"] === JobStatus.PENDING,
        );
        // counter enforces the limit: exactly 2 acquired (= instanceConcurrency)
        expect(acquireCalls).toHaveLength(2);
      }),
    );
  });
});
