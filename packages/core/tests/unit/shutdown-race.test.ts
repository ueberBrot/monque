import { EventEmitter } from "node:events";
import { fromPartial } from "@total-typescript/shoehorn";
import type { FindCursor, ChangeStream, Collection, Db, Document, WithId } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { JobStatus } from "@/jobs";
import { Monque } from "@/scheduler";
import { JobFactoryHelpers } from "@tests/factories";
import { anyMatcher, objectContainingMatcher } from "@tests/setup/matchers.js";
import type { MockFunction, NativeMock } from "@tests/setup/mock-function.js";

describe("Monque Shutdown Race Condition", () => {
  let db: NativeMock<Db>;
  let collection: NativeMock<Collection>;
  let monque: Monque;
  beforeEach(() => {
    vi.useFakeTimers();
    // Create a partial mock of the collection
    collection = fromPartial<NativeMock<Collection>>({
      createIndexes: vi.fn<MockFunction<Collection["createIndexes"]>>(),
      findOneAndUpdate: vi.fn<MockFunction<Collection["findOneAndUpdate"]>>(),
      aggregate: vi.fn<MockFunction<Collection["aggregate"]>>().mockReturnValue(
        fromPartial({
          toArray: vi.fn<MockFunction<FindCursor["toArray"]>>().mockResolvedValue([
            { _id: "work", nextRunAt: new Date(0) },
            { _id: "test-job", nextRunAt: new Date(0) },
          ]),
        }),
      ),
      watch: vi.fn<MockFunction<Collection["watch"]>>(),
      updateMany: vi.fn<MockFunction<Collection["updateMany"]>>(),
      updateOne: vi.fn<MockFunction<Collection["updateOne"]>>(),
      deleteMany: vi.fn<MockFunction<Collection["deleteMany"]>>(),
      find: vi.fn<MockFunction<Collection["find"]>>(),
      findOne: vi.fn<MockFunction<Collection["findOne"]>>(),
      insertOne: vi.fn<MockFunction<Collection["insertOne"]>>(),
    });
    db = fromPartial<NativeMock<Db>>({
      collection: vi
        .fn<MockFunction<Db["collection"]>>()
        .mockReturnValue(fromPartial<Collection>(collection)),
    });
    monque = new Monque(fromPartial<Db>(db), {
      pollInterval: 1000,
      // Must exceed one to exercise continuation of the claim loop.
      workerConcurrency: 5,
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([false, true])(
    "clears the shutdown deadline when a handler drains (failure: %s)",
    async (fail) => {
      monque = new Monque(fromPartial<Db>(db), { recoverStaleJobs: false, workerConcurrency: 1 });
      await monque.initialize();
      const started: PromiseWithResolvers<void> = Promise.withResolvers();
      const release: PromiseWithResolvers<void> = Promise.withResolvers();
      collection.findOneAndUpdate
        .mockResolvedValueOnce(JobFactoryHelpers.processing({ name: "work" }))
        .mockResolvedValue(null);
      monque.register("work", async () => {
        started.resolve();
        await release.promise;

        if (fail) {
          throw new Error("Handler failed during shutdown");
        }
      });
      monque.start();
      await started.promise;
      const stopping = monque.stop();
      await vi.advanceTimersByTimeAsync(0);
      release.resolve();
      await stopping;
      await monque.stop();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("drains workers and stops lease renewal when a change stream closed listener throws", async () => {
    monque = new Monque(fromPartial<Db>(db), {
      recoverStaleJobs: false,
      workerConcurrency: 1,
      leaseDuration: 1000,
      heartbeatInterval: 20,
    });

    // oxlint-disable-next-line unicorn/prefer-event-target -- MongoDB ChangeStream extends Node's EventEmitter, including synchronous listener exceptions.
    const stream = Object.assign(new EventEmitter(), {
      close: vi.fn<MockFunction<ChangeStream["close"]>>().mockResolvedValue(undefined),
    });

    collection.watch.mockReturnValue(fromPartial<ChangeStream>(stream));
    await monque.initialize();
    const started: PromiseWithResolvers<void> = Promise.withResolvers();
    const release: PromiseWithResolvers<void> = Promise.withResolvers();
    const processing = JobFactoryHelpers.processing({ name: "work" });
    const completed = JobFactoryHelpers.completed({ _id: processing._id, name: "work" });
    collection.findOneAndUpdate
      .mockResolvedValueOnce(processing)
      .mockResolvedValueOnce(completed)
      .mockResolvedValue(null);
    const listenerError = new Error("Closed listener failed");
    monque.on("changestream:closed", () => {
      throw listenerError;
    });
    const completionEvents: string[] = [];
    monque.on("job:complete", ({ job }) => {
      completionEvents.push(job.name);
    });
    monque.register("work", async () => {
      started.resolve();
      await release.promise;
    });
    monque.start();

    try {
      await started.promise;
      const stopped = Promise.allSettled([monque.stop()]);
      await vi.advanceTimersByTimeAsync(0);
      expect({
        healthy: monque.isHealthy(),
        completionEvents,
      }).toStrictEqual({
        healthy: false,
        completionEvents: [],
      });
      release.resolve();
      await expect(stopped).resolves.toStrictEqual([{ status: "fulfilled", value: undefined }]);
      expect({
        completionEvents,
        timerCount: vi.getTimerCount(),
      }).toStrictEqual({
        completionEvents: ["work"],
        timerCount: 0,
      });
    } finally {
      release.resolve();
      await monque.stop();
      await vi.advanceTimersByTimeAsync(0);
    }
  });

  it("stops while a claim is pending and releases its late result", async () => {
    // Mock updateMany to simulate successful stale job recovery during initialization
    collection.updateMany.mockResolvedValue({
      modifiedCount: 0,
      upsertedId: null,
      upsertedCount: 0,
      matchedCount: 0,
      acknowledged: true,
    });
    await monque.initialize();
    // Register a worker so poll() simulates fetching jobs
    monque.register("test-job", vi.fn<() => Promise<void>>().mockResolvedValue(undefined));

    // Setup a controlled promise to hang on the first findOneAndUpdate call
    const { promise: firstCallPromise, resolve: resolveFirstCall } =
      Promise.withResolvers<WithId<Document> | null>();

    // 1st call hangs (simulating long DB op), subsequent calls return null (to stop poll loop)
    collection.findOneAndUpdate.mockReturnValueOnce(firstCallPromise).mockResolvedValue(null);
    const started = vi.fn<() => void>();
    monque.on("job:start", () => {
      started();
    });
    // Start Monque (triggers poll via setInterval)
    monque.start();
    // Allow initial discovery to finish and begin the first claim.
    await vi.advanceTimersByTimeAsync(0);
    // The first claim is pending before the worker fills its remaining slots.
    expect(collection.findOneAndUpdate).toHaveBeenCalledOnce();
    // Trigger stop() while acquisition is pending
    const stopPromise = monque.stop();
    await expect(stopPromise).resolves.toBeUndefined();
    resolveFirstCall(
      fromPartial<WithId<Document>>({
        _id: "job-1",
        name: "test-job",
        status: JobStatus.PROCESSING,
        data: {},
      }),
    );

    // Wait for the acquisition promise chain to process the resolved job.
    for (let i = 0; i < 10; i += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Advance ten successive native Promise turns; parallel resolution would not flush the claim-release chain.
      await Promise.resolve();
    }

    // No public execution event may escape for a claim arriving after stop.
    expect(started).not.toHaveBeenCalled();
    // Ensure the claim was reverted correctly
    expect(collection.updateOne).toHaveBeenCalledWith(
      { _id: "job-1", status: JobStatus.PROCESSING, claimedBy: anyMatcher(String), claimId: null },
      {
        $set: objectContainingMatcher({ status: JobStatus.PENDING }),
        $unset: { lockedAt: "", claimedBy: "", claimId: "", leaseExpiresAt: "", lastHeartbeat: "" },
      },
    );
    await stopPromise;
    // Shutdown must prevent the next acquisition batch after this claim resolves.
    expect(collection.findOneAndUpdate).toHaveBeenCalledOnce();
  });

  it("applies synchronous pause and inspection while a Claim is pending", async () => {
    monque = new Monque(fromPartial<Db>(db), { recoverStaleJobs: false });
    await monque.initialize();
    const claim = Promise.withResolvers<WithId<Document> | null>();
    const handler = vi.fn<() => void>();
    monque.register("test-job", () => {
      handler();
    });
    collection.findOneAndUpdate.mockReturnValueOnce(claim.promise).mockResolvedValue(null);
    monque.start();

    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(collection.findOneAndUpdate).toHaveBeenCalledOnce();
      monque.pause("test-job");
      expect(monque.getProcessingState("test-job")).toMatchObject({
        paused: true,
        globallyPaused: false,
      });
      monque.resume("test-job");
      expect(monque.isPaused("test-job")).toBe(false);
      monque.pause();
      expect({
        state: monque.getProcessingState("test-job"),
        healthy: monque.isHealthy(),
      }).toMatchObject({
        state: { paused: true, globallyPaused: true },
        healthy: true,
      });
      claim.resolve(JobFactoryHelpers.processing({ name: "test-job" }));
      await vi.advanceTimersByTimeAsync(0);
      expect({
        executions: handler.mock.calls.length,
        releases: collection.updateOne.mock.calls.length,
      }).toStrictEqual({
        executions: 0,
        releases: 1,
      });
    } finally {
      claim.resolve(null);
      await monque.stop();
    }
  });

  it("releases capacity when a synchronous start listener changes the delivered Claim", async () => {
    monque = new Monque(fromPartial<Db>(db), {
      recoverStaleJobs: false,
      workerConcurrency: 1,
      shutdownTimeout: 0,
    });
    await monque.initialize();
    const first = JobFactoryHelpers.processing({ name: "work", claimId: "first" });
    const second = JobFactoryHelpers.processing({ name: "work", claimId: "second" });
    const claims = [first, second];
    collection.findOneAndUpdate.mockImplementation(
      async (filter) =>
        await Promise.resolve(
          filter["status"] === JobStatus.PENDING ? (claims.shift() ?? null) : null,
        ),
    );
    const started: string[] = [];
    monque.on("job:start", (job) => {
      started.push(job.claimId ?? "missing");
      job.claimId = "listener-changed";
    });
    monque.register("work", () => {});
    monque.start();

    try {
      await vi.advanceTimersByTimeAsync(100);
      expect(started).toStrictEqual(["first", "second"]);
    } finally {
      const stopping = monque.stop();
      await vi.advanceTimersByTimeAsync(0);
      await stopping;
    }
  });
});
