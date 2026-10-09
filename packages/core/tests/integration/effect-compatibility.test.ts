import type { Db } from "mongodb";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { JobStatus, Monque, NonRetryableError, ShutdownTimeoutError } from "@/index";
import type { MonqueEventMap } from "@/index";
import {
  cleanupTestDb,
  getTestDb,
  stopMonqueInstances,
  uniqueCollectionName,
  waitFor,
} from "@test-utils/test-utils";

class DeliveryError extends Error {
  override name = "DeliveryError";
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
      monque.on("job:fail", (event) => {
        failures.push(event);
      });
      monque.register("delivery", vi.fn<() => Promise<void>>().mockRejectedValue(error));
      const job = await monque.enqueue("delivery", {});
      monque.start();
      await waitFor(() => failures.length === 1);
      await monque.stop();
      expect({
        failures: failures.length,
        originalError: failures[0]?.error === error,
        failures0WillRetry: failures[0]?.willRetry,
      }).toStrictEqual({
        failures: 1,
        originalError: true,
        failures0WillRetry: false,
      });
      await expect(monque.getJob(job._id)).resolves.toMatchObject({
        status: JobStatus.FAILED,
        failCount: 1,
        failReason: error.message,
      });
      await expect(monque.getQueueViewSummaries({ name: "delivery" })).resolves.toMatchObject([
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
    const releaseFirst: PromiseWithResolvers<void> = Promise.withResolvers();
    const releaseSecond: PromiseWithResolvers<void> = Promise.withResolvers();
    const started: number[] = [];
    const completed: number[] = [];
    const shutdownErrors: ShutdownTimeoutError[] = [];
    let active = 0;
    let peakActive = 0;
    let firstFinished = false;
    monque.on("job:error", ({ error }) => {
      if (error instanceof ShutdownTimeoutError) {
        shutdownErrors.push(error);
      }
    });
    monque.on("job:complete", ({ job }) => {
      if (job.name === "delivery") {
        completed.push(z.object({ sequence: z.number() }).parse(job.data).sequence);
      }
    });
    monque.register<{
      sequence: number;
    }>("delivery", async (job) => {
      started.push(job.data.sequence);
      active += 1;
      peakActive = Math.max(peakActive, active);
      try {
        if (job.data.sequence === 1) {
          await releaseFirst.promise;
          firstFinished = true;
        } else {
          await releaseSecond.promise;
        }
      } finally {
        active -= 1;
      }
    });
    monque.register("checkpoint", vi.fn<() => Promise<void>>().mockResolvedValue(undefined));
    const first = await monque.enqueue("delivery", { sequence: 1 });
    monque.start();
    try {
      await waitFor(() => started.length === 1);
      await expect(monque.stop()).resolves.toBeUndefined();
      const stoppedJob = await monque.getJob(first._id);
      const stoppedQueues = await monque.getQueueViewSummaries({ name: "delivery" });
      expect({
        shutdownErrors: shutdownErrors.length,
        incompleteJobIds: shutdownErrors[0]?.incompleteJobs.map((job) => job._id?.toString()),
        firstFinished,
        completed,
        job: stoppedJob,
        queueViews: stoppedQueues,
      }).toMatchObject({
        shutdownErrors: 1,
        incompleteJobIds: [first._id.toString()],
        firstFinished: false,
        completed: [],
        job: { status: JobStatus.PROCESSING },
        queueViews: [{ worker: { concurrency: 1, activeCount: 1 } }],
      });
      const second = await monque.enqueue("delivery", { sequence: 2 });
      const checkpoint = await monque.enqueue("checkpoint", {});
      monque.start();
      await waitFor(async () => {
        const awaitedResult1 = await monque.getJob(checkpoint._id);
        return awaitedResult1?.status === JobStatus.COMPLETED;
      });
      const waitingJob = await monque.getJob(second._id);
      const restartedQueues = await monque.getQueueViewSummaries({ name: "delivery" });
      expect({ started, job: waitingJob, queueViews: restartedQueues }).toMatchObject({
        started: [1],
        job: { status: JobStatus.PENDING },
        queueViews: [{ stats: { pending: 1, processing: 1 }, worker: { activeCount: 1 } }],
      });
      releaseFirst.resolve();
      await waitFor(() => started.length === 2 && completed.includes(1));
      const completedFirstJob = await monque.getJob(first._id);
      const releasedQueues = await monque.getQueueViewSummaries({ name: "delivery" });
      expect({
        firstFinished,
        started,
        peakActive,
        job: completedFirstJob,
        queueViews: releasedQueues,
      }).toMatchObject({
        firstFinished: true,
        started: [1, 2],
        peakActive: 1,
        job: { status: JobStatus.COMPLETED },
        queueViews: [
          { stats: { pending: 0, processing: 1, completed: 1 }, worker: { activeCount: 1 } },
        ],
      });
      releaseSecond.resolve();
      await waitFor(async () => {
        const awaitedResult2 = await monque.getQueueViewSummaries({ name: "delivery" });
        const [summary] = awaitedResult2;
        return summary?.stats.completed === 2 && summary.worker?.activeCount === 0;
      });
      expect({
        completed,
        peakActive,
        active,
        shutdownErrors: shutdownErrors.length,
      }).toStrictEqual({
        completed: [1, 2],
        peakActive: 1,
        active: 0,
        shutdownErrors: 1,
      });
    } finally {
      releaseFirst.resolve();
      releaseSecond.resolve();
      await monque.stop();
      await waitFor(async () => {
        const awaitedResult3 = await monque.getQueueViewSummaries({ name: "delivery" });
        const [summary] = awaitedResult3;
        return active === 0 && summary?.worker?.activeCount === 0;
      });
    }
  });
});
