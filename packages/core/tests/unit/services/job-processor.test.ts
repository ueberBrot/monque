/**
 * Unit tests for JobProcessor service.
 *
 * Tests job polling, acquisition, processing, completion, and failure handling.
 * Uses mock SchedulerContext to test processing logic in isolation.
 */

import { ReadConcern } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

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

  describe("poll", () => {
    it("discovers an idle collection once without probing every registered name", async () => {
      for (let i = 0; i < 100; i++) {
        ctx.workers.set(`worker-${i}`, createWorker());
      }
      vi.mocked(ctx.mockCollection.aggregate).mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      } as unknown as ReturnType<typeof ctx.mockCollection.aggregate>);

      await processor.poll();

      expect(ctx.mockCollection.aggregate).toHaveBeenCalledOnce();
      expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it("arms persisted future deadlines without trying to claim them early", async () => {
      ctx.workers.set("work", createWorker());
      const runAt = new Date(Date.now() + 5000);
      vi.mocked(ctx.mockCollection.aggregate).mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ _id: "work", nextRunAt: runAt }]),
      } as unknown as ReturnType<typeof ctx.mockCollection.aggregate>);

      await processor.poll();

      expect(ctx.notifyPendingJob).toHaveBeenCalledExactlyOnceWith("work", runAt);
      expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it("probes a notified name without a preliminary discovery read", async () => {
      ctx.workers.set("work", createWorker());
      vi.mocked(ctx.mockCollection.findOneAndUpdate).mockResolvedValue(null);

      await processor.poll(new Set(["work"]));

      expect(ctx.mockCollection.aggregate).not.toHaveBeenCalled();
      expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalledOnce();
    });

    it.each([false, true])(
      "does not retry jobs already claimed on the primary, targeted poll: %s",
      async (targeted) => {
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

        await processor.poll(targeted ? new Set(["work"]) : undefined);

        expect(ctx.notifyPendingJob).not.toHaveBeenCalled();
        expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalledTimes(targeted ? 1 : 0);
      },
    );

    it("does not turn failed claims into immediate retry notifications", async () => {
      ctx.workers.set("work", createWorker());
      vi.mocked(ctx.mockCollection.findOneAndUpdate).mockRejectedValue(
        new Error("Write unavailable"),
      );
      vi.mocked(ctx.mockCollection.findOne).mockResolvedValue({
        _id: "work",
        nextRunAt: new Date(0),
      });

      await processor.poll(new Set(["work"]));

      expect(ctx.notifyPendingJob).not.toHaveBeenCalled();
    });

    it("falls back to atomic claims when discovery fails", async () => {
      ctx.workers.set("work", createWorker());
      const error = new Error("Read unavailable");
      vi.mocked(ctx.mockCollection.aggregate).mockReturnValue({
        toArray: vi.fn().mockRejectedValue(error),
      } as unknown as ReturnType<typeof ctx.mockCollection.aggregate>);
      vi.mocked(ctx.mockCollection.findOneAndUpdate).mockResolvedValue(null);

      await processor.poll();

      expect(ctx.emit).toHaveBeenCalledWith("job:error", { error });
      expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalledOnce();
    });

    it.each(["collation", "metadata unavailable"])(
      "keeps atomic discovery when indexed discovery is unsafe: %s",
      async (reason) => {
        ctx.workers.set("work", createWorker());
        const metadata = vi.mocked(ctx.mockCollection.options);
        if (reason === "collation") {
          metadata.mockResolvedValue({ collation: { locale: "en", strength: 2 } });
        } else {
          metadata.mockRejectedValue(new Error("Collection metadata access denied"));
        }
        vi.mocked(ctx.mockCollection.findOneAndUpdate).mockResolvedValue(null);

        await processor.poll();
        await processor.poll();

        expect(metadata).toHaveBeenCalledOnce();
        expect(ctx.mockCollection.aggregate).not.toHaveBeenCalled();
        expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalledTimes(2);
        expect(ctx.emitHistory.filter(({ event }) => event === "job:error")).toHaveLength(
          reason === "collation" ? 0 : 1,
        );
      },
    );

    it.each(["stop", "pause"])("does not claim after %s during discovery", async (action) => {
      ctx.workers.set("work", createWorker());
      const discovery = Promise.withResolvers<Array<{ _id: string; nextRunAt: Date }>>();
      vi.mocked(ctx.mockCollection.aggregate).mockReturnValue({
        toArray: vi.fn(() => discovery.promise),
      } as unknown as ReturnType<typeof ctx.mockCollection.aggregate>);
      const polling = processor.poll();
      if (action === "stop") vi.mocked(ctx.isRunning).mockReturnValue(false);
      else vi.mocked(ctx.isPaused).mockReturnValue(true);
      discovery.resolve([{ _id: "work", nextRunAt: new Date(0) }]);
      await polling;
      expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it.each([false, true])(
      "does not invoke a handler if paused during acquisition (release fails: %s)",
      async (releaseFails) => {
        const lifecycle = new JobLifecycle(ctx);
        processor = new JobProcessor(ctx, lifecycle);
        const acquisition = Promise.withResolvers<PersistedJob | null>();
        const claimed = JobFactoryHelpers.processing({ name: "work" });
        const handler = vi.fn(async () => {});
        ctx.workers.set("work", createWorker({ handler }));
        const claim = vi.spyOn(lifecycle, "claimNext").mockReturnValueOnce(acquisition.promise);
        const release = vi.spyOn(lifecycle, "releaseOwnedClaim").mockResolvedValue();
        if (releaseFails) release.mockRejectedValue(new Error("Release failed"));
        const polling = processor.poll();
        await vi.waitFor(() => expect(claim).toHaveBeenCalled());
        vi.mocked(ctx.isPaused).mockReturnValue(true);
        acquisition.resolve(claimed);
        await polling;
        expect(handler).not.toHaveBeenCalled();
        expect(release).toHaveBeenCalledExactlyOnceWith(claimed);
        if (releaseFails) {
          expect(ctx.emit).toHaveBeenCalledWith("job:error", {
            error: expect.objectContaining({ message: "Release failed" }),
            job: claimed,
          });
        }
      },
    );

    it("continues processing after a job:start listener throws with one global slot", async () => {
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

      await processor.poll();
      await processor.poll();

      expect(handler).toHaveBeenCalledExactlyOnceWith(next);
      expect(worker.activeJobs.size).toBe(0);
      expect(ctx.notifyJobFinished).toHaveBeenCalledTimes(2);
    });

    it("should not poll if scheduler is not running", async () => {
      vi.spyOn(ctx, "isRunning").mockReturnValue(false);

      await processor.poll();

      expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it("should poll for each registered worker with available capacity", async () => {
      ctx.workers.set("test-job", createWorker({ concurrency: 2 }));

      vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockResolvedValue(null);

      await processor.poll();

      expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalled();
    });

    it("should skip workers at max concurrency", async () => {
      const job = JobFactory.build();
      ctx.workers.set(
        "test-job",
        createWorker({
          concurrency: 1,
          activeJobs: new Map<string, PersistedJob>([["job-1", job]]),
        }),
      );

      await processor.poll();

      expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it("should exit early when instanceConcurrency is reached", async () => {
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

      await processor.poll();

      const callsAfterFirstPoll = (ctx.mockCollection.findOneAndUpdate as ReturnType<typeof vi.fn>)
        .mock.calls.length;
      vi.clearAllMocks();

      // Now the counter is at 2 (= instanceConcurrency), a second poll should not acquire
      await processor.poll();

      expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
      expect(callsAfterFirstPoll).toBeGreaterThan(0);

      // Clean up dangling promises
      resolveHandlers?.();
      await new Promise<void>((r) => setTimeout(r, 0));
    });

    it("should limit job acquisition to available global slots", async () => {
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

      await processor.poll();

      // With instanceConcurrency 3 and starting at 0, poll acquires up to 3 jobs (seedJob and newJob)
      // Should attempt acquisitions
      expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalled();
    });

    it("should stop acquiring jobs when global limit is reached mid-poll", async () => {
      ctx.options.instanceConcurrency = 2;

      const newJob1 = JobFactory.build({ name: "test-job" });
      const newJob2 = JobFactory.build({ name: "test-job" });

      ctx.workers.set("test-job", createWorker({ concurrency: 10 }));

      const spy = vi
        .spyOn(ctx.mockCollection, "findOneAndUpdate")
        .mockResolvedValueOnce(newJob1)
        .mockResolvedValueOnce(newJob2)
        .mockResolvedValue(null);

      await processor.poll();

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
    });

    it("should stop claiming after an empty result even with high concurrency", async () => {
      // instanceConcurrency is undefined by default
      expect(ctx.options.instanceConcurrency).toBeUndefined();

      ctx.workers.set("test-job", createWorker({ concurrency: 100 }));

      vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockResolvedValue(null);

      await processor.poll();

      expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalledOnce();
    });

    it("fills available slots when jobs are waiting", async () => {
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

      await processor.poll();

      expect(handler).toHaveBeenCalledTimes(8);
      expect(worker.activeJobs.size).toBe(8);
      finishHandlers?.();
      await vi.waitFor(() => expect(worker.activeJobs.size).toBe(0));
    });

    it("should re-poll when a poll request arrives while already polling", async () => {
      ctx.workers.set("test-job", createWorker({ concurrency: 1 }));

      let firstPollResolve: (() => void) | undefined;
      const firstPollPromise = new Promise<void>((resolve) => {
        firstPollResolve = resolve;
      });

      const spy = vi
        .spyOn(ctx.mockCollection, "findOneAndUpdate")
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              // Hold the first poll open until we signal it
              firstPollPromise.then(() => resolve(null));
            }),
        )
        .mockResolvedValue(null);

      // Start first poll (will be held open)
      const pollPromise = processor.poll();
      await vi.waitFor(() => expect(spy).toHaveBeenCalledOnce());

      // While first poll is running, request another poll
      const secondPollPromise = processor.poll(new Set(["test-job"]));

      // The second poll should stay queued until the first poll finishes.
      expect(spy).toHaveBeenCalledTimes(1);

      // Release the first poll
      firstPollResolve?.();
      await secondPollPromise;
      await pollPromise;

      // First poll: 1 call. Re-poll (full): 1 call.
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it.each([false, true])(
      "retains overlapping discovery scope, full requested: %s",
      async (full) => {
        for (const name of ["first", "second", "unrelated"]) {
          ctx.workers.set(name, createWorker());
        }
        const acquisition = Promise.withResolvers<null>();
        const claim = vi
          .mocked(ctx.mockCollection.findOneAndUpdate)
          .mockReturnValueOnce(acquisition.promise)
          .mockResolvedValue(null);

        const polling = processor.poll(new Set(["first"]));
        await vi.waitFor(() => expect(claim).toHaveBeenCalledOnce());
        if (full) await processor.poll();
        await processor.poll(new Set(["second"]));
        acquisition.resolve(null);
        await polling;

        expect(claim.mock.calls.map(([filter]) => filter["name"])).toEqual(
          full ? ["first", "first", "second", "unrelated"] : ["first", "second"],
        );
      },
    );

    it("bounds overlapping notifications with full discovery, then restores targeting", async () => {
      for (const name of ["first", "second", "unrelated"]) {
        ctx.workers.set(name, createWorker());
      }
      const acquisition = Promise.withResolvers<null>();
      const claim = vi
        .mocked(ctx.mockCollection.findOneAndUpdate)
        .mockReturnValueOnce(acquisition.promise)
        .mockResolvedValue(null);

      const polling = processor.poll(new Set(["first"]));
      await vi.waitFor(() => expect(claim).toHaveBeenCalledOnce());
      await processor.poll(
        new Set(["second", ...Array.from({ length: 1024 }, (_, i) => `unregistered-${i}`)]),
      );
      acquisition.resolve(null);
      await polling;

      expect(ctx.mockCollection.aggregate).toHaveBeenCalledOnce();
      expect(claim.mock.calls.map(([filter]) => filter["name"])).toEqual([
        "first",
        "first",
        "second",
        "unrelated",
      ]);

      vi.clearAllMocks();
      await processor.poll(new Set(["second"]));
      expect(ctx.mockCollection.aggregate).not.toHaveBeenCalled();
      expect(claim.mock.calls.map(([filter]) => filter["name"])).toEqual(["second"]);
    });
  });

  describe("worker execution through poll", () => {
    it("should execute handler and emit job:start and job:complete events", async () => {
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
      await processor.poll(new Set([job.name]));
      await vi.waitFor(() => expect(worker.activeJobs.size).toBe(0));

      expect(handler).toHaveBeenCalledWith(job);
      expect(ctx.emitHistory).toContainEqual(expect.objectContaining({ event: "job:start" }));
      expect(ctx.emitHistory).toContainEqual(expect.objectContaining({ event: "job:complete" }));
    });

    it("should emit job:complete with the actual DB document, not the stale in-memory job", async () => {
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
      await processor.poll(new Set([job.name]));
      await vi.waitFor(() => expect(worker.activeJobs.size).toBe(0));

      const completeEvent = ctx.emitHistory.find((e) => e.event === "job:complete");
      const payload = completeEvent?.payload as { job: PersistedJob; duration: number };
      expect(payload.job.status).toBe(JobStatus.COMPLETED);
      expect(payload.job._id).toEqual(job._id);
    });

    it("should call failJob and emit job:fail on handler error", async () => {
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
      await processor.poll(new Set([job.name]));
      await vi.waitFor(() => expect(worker.activeJobs.size).toBe(0));

      expect(ctx.emitHistory).toContainEqual(expect.objectContaining({ event: "job:fail" }));
      const failEvent = ctx.emitHistory.find((e) => e.event === "job:fail");
      expect((failEvent?.payload as { error: Error })?.error?.message).toBe("Handler failed");
    });

    it("should coerce non-Error thrown values to Error objects", async () => {
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
      await processor.poll(new Set([job.name]));
      await vi.waitFor(() => expect(worker.activeJobs.size).toBe(0));

      expect(ctx.emitHistory).toContainEqual(expect.objectContaining({ event: "job:fail" }));
      const failEvent = ctx.emitHistory.find((e) => e.event === "job:fail");
      const payload = failEvent?.payload as { error: Error };
      expect(payload.error).toBeInstanceOf(Error);
      expect(payload.error.message).toBe("String error message");
    });

    it("should track job in activeJobs during processing and remove after", async () => {
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
      await processor.poll(new Set([job.name]));
      await vi.waitFor(() => expect(worker.activeJobs.size).toBe(0));

      expect(worker.activeJobs.size).toBe(0);
    });

    it("should not emit job:complete when completeJob returns null (race condition)", async () => {
      const job = JobFactoryHelpers.processing();
      const worker = createWorker();

      // completeJob returns null (job was deleted or status changed concurrently)
      vi.spyOn(ctx.mockCollection, "findOneAndUpdate")
        .mockResolvedValueOnce(job)
        .mockResolvedValueOnce(null);

      ctx.workers.set(job.name, worker);
      await processor.poll(new Set([job.name]));
      await vi.waitFor(() => expect(worker.activeJobs.size).toBe(0));

      expect(ctx.emitHistory).toContainEqual(expect.objectContaining({ event: "job:start" }));
      expect(ctx.emitHistory).not.toContainEqual(
        expect.objectContaining({ event: "job:complete" }),
      );
    });

    it("should not emit job:fail when failJob returns null (race condition)", async () => {
      const job = JobFactoryHelpers.processing({ failCount: 0 });
      const worker = createWorker({
        handler: vi.fn().mockRejectedValue(new Error("Handler failed")),
      });

      // failJob returns null (job was deleted or status changed concurrently)
      vi.spyOn(ctx.mockCollection, "findOneAndUpdate")
        .mockResolvedValueOnce(job)
        .mockResolvedValueOnce(null);

      ctx.workers.set(job.name, worker);
      await processor.poll(new Set([job.name]));
      await vi.waitFor(() => expect(worker.activeJobs.size).toBe(0));

      expect(ctx.emitHistory).toContainEqual(expect.objectContaining({ event: "job:start" }));
      expect(ctx.emitHistory).not.toContainEqual(expect.objectContaining({ event: "job:fail" }));
    });

    it("should derive willRetry from actual DB status (PENDING = retry, FAILED = no retry)", async () => {
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
      await processor.poll(new Set([job1.name]));
      await vi.waitFor(() => expect(worker1.activeJobs.size).toBe(0));

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
      await processor.poll(new Set([job2.name]));
      await vi.waitFor(() => expect(worker2.activeJobs.size).toBe(0));

      const failEvent = ctx.emitHistory.find((e) => e.event === "job:fail");
      expect((failEvent?.payload as { willRetry: boolean })?.willRetry).toBe(false);
    });

    it("should still remove job from activeJobs even when transition returns null", async () => {
      const job = JobFactoryHelpers.processing();
      const worker = createWorker();

      vi.spyOn(ctx.mockCollection, "findOneAndUpdate")
        .mockResolvedValueOnce(job)
        .mockResolvedValueOnce(null);

      ctx.workers.set(job.name, worker);
      await processor.poll(new Set([job.name]));
      await vi.waitFor(() => expect(worker.activeJobs.size).toBe(0));

      expect(worker.activeJobs.size).toBe(0);
    });

    it("should call notifyJobFinished after successful completion", async () => {
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
      await processor.poll(new Set([job.name]));
      await vi.waitFor(() => expect(worker.activeJobs.size).toBe(0));

      expect(ctx.notifyJobFinished).toHaveBeenCalledOnce();
    });

    it("should call notifyJobFinished after failure", async () => {
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
      await processor.poll(new Set([job.name]));
      await vi.waitFor(() => expect(worker.activeJobs.size).toBe(0));

      expect(ctx.notifyJobFinished).toHaveBeenCalledOnce();
    });
  });

  describe("_totalActiveJobs counter", () => {
    it("should increment counter when job is acquired via poll and decrement after completion", async () => {
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

      await processor.poll();

      // processJob runs asynchronously; flush the microtask queue
      await new Promise<void>((r) => setTimeout(r, 0));

      const worker = ctx.workers.get("test-job");
      expect(worker?.activeJobs.size).toBe(0);
    });

    it("should decrement counter even when processJob handler fails", async () => {
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

      await processor.poll();
      await new Promise<void>((r) => setTimeout(r, 0));

      const worker = ctx.workers.get("test-job");
      expect(worker?.activeJobs.size).toBe(0);
    });

    it("should decrement counter even when DB transition returns null (race condition)", async () => {
      const acquiredJob = JobFactory.build({ name: "test-job" });
      ctx.workers.set("test-job", createWorker({ concurrency: 3 }));

      vi.spyOn(ctx.mockCollection, "findOneAndUpdate")
        .mockResolvedValueOnce(acquiredJob) // acquireJob
        .mockResolvedValueOnce(null) // second acquire: no more
        .mockResolvedValueOnce(null); // completeJob: race condition null

      await processor.poll();
      await new Promise<void>((r) => setTimeout(r, 0));

      const worker = ctx.workers.get("test-job");
      expect(worker?.activeJobs.size).toBe(0);
    });

    it("should cap poll acquisitions at instanceConcurrency using the O(1) counter", async () => {
      ctx.options.instanceConcurrency = 2;
      ctx.workers.set("test-job", createWorker({ concurrency: 10 }));

      const job1 = JobFactory.build({ name: "test-job" });
      const job2 = JobFactory.build({ name: "test-job" });

      const spy = vi
        .spyOn(ctx.mockCollection, "findOneAndUpdate")
        .mockResolvedValueOnce(job1)
        .mockResolvedValueOnce(job2)
        .mockResolvedValue(null);

      await processor.poll();

      const acquireCalls = spy.mock.calls.filter(
        (args) =>
          typeof args[0] === "object" &&
          args[0] !== null &&
          "status" in args[0] &&
          args[0]["status"] === JobStatus.PENDING,
      );
      // counter enforces the limit: exactly 2 acquired (= instanceConcurrency)
      expect(acquireCalls).toHaveLength(2);
    });
  });
});
