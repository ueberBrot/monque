import type { Db } from "mongodb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";

import {
  JobStatus,
  Monque,
  type MonqueEventMap,
  NonRetryableError,
  ShutdownTimeoutError,
} from "@/index";
import {
  cleanupTestDb,
  getTestDb,
  stopMonqueInstances,
  uniqueCollectionName,
  waitFor,
} from "@test-utils/test-utils";

class DeliveryError extends Error {
  readonly code = "DELIVERY_REJECTED";
}

describe("Promise worker compatibility", () => {
  let db: Db;
  const instances: Monque[] = [];

  beforeAll(async () => {
    db = await getTestDb("effect-compatibility");
  });

  afterEach(async () => {
    await stopMonqueInstances(instances);
  });

  afterAll(async () => {
    await cleanupTestDb(db);
  });

  it.each([
    {
      description: "non-retryable error",
      error: new NonRetryableError("Account deleted"),
      maxRetries: 10,
    },
    { description: "custom error", error: new DeliveryError("Delivery rejected"), maxRetries: 1 },
  ])(
    "preserves the original $description in terminal failure events",
    async ({ error, maxRetries }) => {
      const monque = new Monque(db, {
        collectionName: uniqueCollectionName("failure-identity"),
        pollInterval: 20,
        safetyPollInterval: 20,
        maxRetries,
      });
      instances.push(monque);
      await monque.initialize();
      const failures: MonqueEventMap["job:fail"][] = [];
      monque.on("job:fail", (event) => failures.push(event));
      monque.register("delivery", async () => {
        throw error;
      });

      const job = await monque.enqueue("delivery", {});
      monque.start();
      await waitFor(async () => failures.length === 1);
      await monque.stop();

      expect(failures).toHaveLength(1);
      expect(failures[0]?.error).toBe(error);
      expect(failures[0]?.willRetry).toBe(false);
      expect(await monque.getJob(job._id)).toMatchObject({
        status: JobStatus.FAILED,
        failCount: 1,
        failReason: error.message,
      });
      expect(await monque.getQueueViewSummaries({ name: "delivery" })).toMatchObject([
        { stats: { pending: 0, processing: 0, failed: 1 }, worker: { activeCount: 0 } },
      ]);
    },
  );

  it("retains a timed-out Promise worker and its capacity across restart until it completes", async () => {
    const monque = new Monque(db, {
      collectionName: uniqueCollectionName("shutdown-restart"),
      pollInterval: 20,
      safetyPollInterval: 20,
      shutdownTimeout: 100,
      workerConcurrency: 1,
      statsCacheTtlMs: 0,
    });
    instances.push(monque);
    await monque.initialize();
    const releaseFirst = Promise.withResolvers<void>();
    const releaseSecond = Promise.withResolvers<void>();
    const started: number[] = [];
    const completed: number[] = [];
    const shutdownErrors: ShutdownTimeoutError[] = [];
    let active = 0;
    let peakActive = 0;
    let firstFinished = false;

    monque.on("job:error", ({ error }) => {
      if (error instanceof ShutdownTimeoutError) shutdownErrors.push(error);
    });
    monque.on("job:complete", ({ job }) => {
      if (job.name === "delivery") completed.push((job.data as { sequence: number }).sequence);
    });
    monque.register<{ sequence: number }>("delivery", async (job) => {
      started.push(job.data.sequence);
      active++;
      peakActive = Math.max(peakActive, active);
      try {
        if (job.data.sequence === 1) {
          await releaseFirst.promise;
          firstFinished = true;
        } else {
          await releaseSecond.promise;
        }
      } finally {
        active--;
      }
    });
    monque.register("checkpoint", async () => {});

    const first = await monque.enqueue("delivery", { sequence: 1 });
    monque.start();
    try {
      await waitFor(async () => started.length === 1);
      await expect(monque.stop()).resolves.toBeUndefined();

      expect(shutdownErrors).toHaveLength(1);
      expect(shutdownErrors[0]?.incompleteJobs.map((job) => job._id?.toString())).toEqual([
        first._id.toString(),
      ]);
      expect(firstFinished).toBe(false);
      expect(completed).toEqual([]);
      expect(await monque.getJob(first._id)).toMatchObject({ status: JobStatus.PROCESSING });
      expect(await monque.getQueueViewSummaries({ name: "delivery" })).toMatchObject([
        { worker: { concurrency: 1, activeCount: 1 } },
      ]);

      const second = await monque.enqueue("delivery", { sequence: 2 });
      const checkpoint = await monque.enqueue("checkpoint", {});
      monque.start();
      await waitFor(
        async () => (await monque.getJob(checkpoint._id))?.status === JobStatus.COMPLETED,
      );

      expect(started).toEqual([1]);
      expect(await monque.getJob(second._id)).toMatchObject({ status: JobStatus.PENDING });
      expect(await monque.getQueueViewSummaries({ name: "delivery" })).toMatchObject([
        { stats: { pending: 1, processing: 1 }, worker: { activeCount: 1 } },
      ]);

      releaseFirst.resolve();
      await waitFor(async () => started.length === 2 && completed.includes(1));
      expect(firstFinished).toBe(true);
      expect(started).toEqual([1, 2]);
      expect(peakActive).toBe(1);
      expect(await monque.getJob(first._id)).toMatchObject({ status: JobStatus.COMPLETED });
      expect(await monque.getQueueViewSummaries({ name: "delivery" })).toMatchObject([
        { stats: { pending: 0, processing: 1, completed: 1 }, worker: { activeCount: 1 } },
      ]);

      releaseSecond.resolve();
      await waitFor(async () => {
        const summary = (await monque.getQueueViewSummaries({ name: "delivery" }))[0];
        return summary?.stats.completed === 2 && summary.worker?.activeCount === 0;
      });
      expect(completed).toEqual([1, 2]);
      expect(peakActive).toBe(1);
      expect(active).toBe(0);
      expect(shutdownErrors).toHaveLength(1);
    } finally {
      releaseFirst.resolve();
      releaseSecond.resolve();
      await monque.stop();
      await waitFor(async () => {
        const summary = (await monque.getQueueViewSummaries({ name: "delivery" }))[0];
        return active === 0 && summary?.worker?.activeCount === 0;
      });
    }
  });
});
