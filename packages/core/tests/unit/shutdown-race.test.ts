import { EventEmitter } from "node:events";
import type { Collection, Db, Document, WithId } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, type Mocked, vi } from "vite-plus/test";

import { JobStatus } from "@/jobs";
import { Monque } from "@/scheduler";
import { JobFactoryHelpers } from "@tests/factories";

describe("Monque Shutdown Race Condition", () => {
  let db: Mocked<Db>;
  let collection: Mocked<Collection>;
  let monque: Monque;

  beforeEach(() => {
    vi.useFakeTimers();

    // Create a partial mock of the collection
    collection = {
      createIndexes: vi.fn(),
      findOneAndUpdate: vi.fn(),
      aggregate: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { _id: "work", nextRunAt: new Date(0) },
          { _id: "test-job", nextRunAt: new Date(0) },
        ]),
      }),
      watch: vi.fn(),
      updateMany: vi.fn(), // Needed for updateHeartbeats / recoverStaleJobs implicitly called
      updateOne: vi.fn(), // Needed for completeJob/failJob
      deleteMany: vi.fn(), // Needed for cleanup
      find: vi.fn(), // Needed for getJobs
      findOne: vi.fn(), // Needed for getJob
      insertOne: vi.fn(), // Needed for enqueue
    } as unknown as Mocked<Collection>;

    db = {
      collection: vi.fn().mockReturnValue(collection),
    } as unknown as Mocked<Db>;

    monque = new Monque(db, {
      pollInterval: 1000,
      defaultConcurrency: 5, // Important: must be > 1 to test loop continuation
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([false, true])(
    "clears the shutdown deadline when a handler drains (failure: %s)",
    async (fail) => {
      monque = new Monque(db, { recoverStaleJobs: false, workerConcurrency: 1 });
      await monque.initialize();
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      collection.findOneAndUpdate
        .mockResolvedValueOnce(JobFactoryHelpers.processing({ name: "work" }))
        .mockResolvedValue(null);
      monque.register("work", async () => {
        started.resolve();
        await release.promise;
        if (fail) throw new Error("Handler failed during shutdown");
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
    monque = new Monque(db, {
      recoverStaleJobs: false,
      workerConcurrency: 1,
      leaseDuration: 1000,
      heartbeatInterval: 20,
    });
    const stream = Object.assign(new EventEmitter(), {
      close: vi.fn().mockResolvedValue(undefined),
    });
    collection.watch.mockReturnValue(stream as unknown as ReturnType<typeof collection.watch>);
    await monque.initialize();
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
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
    monque.on("job:complete", ({ job }) => completionEvents.push(job.name));
    monque.register("work", async () => {
      started.resolve();
      await release.promise;
    });
    monque.start();
    try {
      await started.promise;
      const stopped = monque.stop().then(
        () => ({ status: "fulfilled" }),
        (error: unknown) => ({ status: "rejected", error }),
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(monque.isHealthy()).toBe(false);
      expect(completionEvents).toEqual([]);

      release.resolve();
      await expect(stopped).resolves.toEqual({ status: "fulfilled" });
      expect(completionEvents).toEqual(["work"]);
      expect(vi.getTimerCount()).toBe(0);
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
    monque.register("test-job", async () => {});

    // Setup a controlled promise to hang on the first findOneAndUpdate call
    let resolveFirstCall: ((value: WithId<Document> | null) => void) | undefined;
    const firstCallPromise = new Promise<WithId<Document> | null>((resolve) => {
      resolveFirstCall = resolve;
    });

    // 1st call hangs (simulating long DB op), subsequent calls return null (to stop poll loop)
    collection.findOneAndUpdate
      .mockReturnValueOnce(firstCallPromise as Promise<WithId<Document>>)
      .mockResolvedValue(null);

    // Start Monque (triggers poll via setInterval)
    monque.start();

    // Allow initial discovery to finish and begin the first claim.
    await vi.advanceTimersByTimeAsync(0);

    // The first claim is pending before the worker fills its remaining slots.
    expect(collection.findOneAndUpdate).toHaveBeenCalledOnce();

    // Trigger stop() while acquisition is pending
    const stopPromise = monque.stop();

    await expect(stopPromise).resolves.toBeUndefined();

    if (resolveFirstCall) {
      resolveFirstCall({
        _id: "job-1",
        name: "test-job",
        status: JobStatus.PROCESSING,
        data: {},
      } as unknown as WithId<Document>);
    }

    // Wait for the acquisition promise chain to process the resolved job.
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }

    // Ensure the job was not absorbed into regular active job tracking
    const worker = (
      monque as unknown as { workers: Map<string, { activeJobs: Map<string, unknown> }> }
    ).workers.get("test-job");
    expect(worker?.activeJobs.has("job-1")).toBe(false);

    // Ensure the claim was reverted correctly
    expect(collection.updateOne).toHaveBeenCalledWith(
      { _id: "job-1", status: JobStatus.PROCESSING, claimedBy: expect.any(String), claimId: null },
      {
        $set: expect.objectContaining({ status: JobStatus.PENDING }),
        $unset: { lockedAt: "", claimedBy: "", claimId: "", leaseExpiresAt: "", lastHeartbeat: "" },
      },
    );

    await stopPromise;

    // Shutdown must prevent the next acquisition batch after this claim resolves.
    expect(collection.findOneAndUpdate).toHaveBeenCalledOnce();
  });
});
