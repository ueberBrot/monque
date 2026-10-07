import { Collection, type Db } from "mongodb";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { InvalidJobPriorityError, JobStateError, Monque, NonRetryableError } from "@/index";
import {
  cleanupTestDb,
  getTestDb,
  stopMonqueInstances,
  uniqueCollectionName,
  waitFor,
} from "@test-utils/test-utils";

describe("Changing a pending Job priority", () => {
  let db: Db;
  const instances: Monque[] = [];
  beforeAll(async () => {
    db = await getTestDb("set-priority");
  });
  afterEach(async () => {
    await stopMonqueInstances(instances);
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await cleanupTestDb(db);
  });

  it("promotes and demotes a future Job without changing its other metadata", async () => {
    const collectionName = uniqueCollectionName("priority-edit");
    const monque = new Monque(db, { collectionName });
    instances.push(monque);
    await monque.initialize();
    const created = await monque.enqueue(
      "work",
      { preserved: true },
      {
        runAt: new Date(Date.now() + 60_000),
        uniqueKey: "unchanged",
        priority: 2,
      },
    );
    await db
      .collection(collectionName)
      .updateOne({ _id: created._id }, { $set: { failCount: 2, failReason: "previous attempt" } });
    const job = (await monque.getJob(created._id))!;
    for (const priority of [9, -5, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]) {
      const updated = await monque.setJobPriority(job._id.toHexString(), priority);
      expect(updated).toEqual({ ...job, priority, updatedAt: expect.any(Date) });
      expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(job.updatedAt.getTime());
      expect(await monque.getJob(job._id)).toEqual(updated);
      expect((await monque.getJobSummariesWithCursor()).jobs[0]?.priority).toBe(priority);
    }
  });
  it("rejects invalid runtime priorities before any mutation", async () => {
    const monque = new Monque(db, { collectionName: uniqueCollectionName("priority-invalid") });
    instances.push(monque);
    await monque.initialize();
    const job = await monque.now("work", {}, { priority: 3 });
    for (const priority of [
      undefined,
      null,
      "1",
      true,
      {},
      0.5,
      NaN,
      Infinity,
      -Infinity,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      await expect(
        monque.setJobPriority(job._id.toHexString(), priority as number),
      ).rejects.toThrow(InvalidJobPriorityError);
      expect(await monque.getJob(job._id)).toEqual(job);
    }
  });
  it("retains invalid and missing identifier conventions", async () => {
    const monque = new Monque(db, { collectionName: uniqueCollectionName("priority-missing") });
    instances.push(monque);
    await monque.initialize();
    expect(await monque.setJobPriority("invalid", 2)).toBeNull();
    expect(await monque.setJobPriority("000000000000000000000000", 2)).toBeNull();
  });

  it("wins before a competing Scheduler Instance claims and rejects edits after claim", async () => {
    const collectionName = uniqueCollectionName("priority-race");
    const producer = new Monque(db, { collectionName });
    const consumer = new Monque(db, { collectionName, workerConcurrency: 1 });
    instances.push(producer, consumer);
    await producer.initialize();
    await consumer.initialize();
    const routine = await producer.now("work", "routine", { priority: 1 });
    const promoted = await producer.now("work", "promoted", { priority: -1 });
    await producer.setJobPriority(promoted._id.toHexString(), 5);
    const received: unknown[] = [];
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    consumer.register("work", async (job) => {
      received.push(job.data);
      if (job.data === "promoted") {
        started.resolve();
        await release.promise;
      }
    });
    consumer.start();
    try {
      await started.promise;
      const claimed = await producer.getJob(promoted._id);
      expect(claimed).toMatchObject({ priority: 5, status: "processing" });
      await expect(producer.setJobPriority(promoted._id.toHexString(), -9)).rejects.toThrow(
        JobStateError,
      );
      expect(await producer.getJob(promoted._id)).toEqual(claimed);
    } finally {
      release.resolve();
    }
    await waitFor(async () => (await producer.getJob(routine._id))?.status === "completed");
    expect(received).toEqual(["promoted", "routine"]);
    await expect(producer.setJobPriority(promoted._id.toHexString(), -9)).rejects.toThrow(
      JobStateError,
    );
    const cancelled = await producer.now("cancelled", {});
    await producer.cancelJob(cancelled._id.toHexString());
    await expect(producer.setJobPriority(cancelled._id.toHexString(), 8)).rejects.toThrow(
      JobStateError,
    );
  });

  it("retains an explicit edit through failure, manual retry, reschedule and recurring runs", async () => {
    const monque = new Monque(db, {
      collectionName: uniqueCollectionName("priority-lifecycle"),
      workerConcurrency: 1,
    });
    instances.push(monque);
    await monque.initialize();
    const recurring = await monque.schedule("0 * * * *", "recurring", {});
    await monque.setJobPriority(recurring._id.toHexString(), -4);
    await monque.rescheduleJob(recurring._id.toHexString(), new Date());
    let attempts = 0;
    const priorities: Array<number | undefined> = [];
    monque.register("recurring", (job) => {
      priorities.push(job.priority);
      if (attempts++ === 0) throw new NonRetryableError("requires operator retry");
    });
    monque.start();
    await waitFor(async () => (await monque.getJob(recurring._id))?.status === "failed");
    await expect(monque.setJobPriority(recurring._id.toHexString(), 8)).rejects.toThrow(
      JobStateError,
    );
    expect((await monque.retryJob(recurring._id.toHexString()))?.priority).toBe(-4);
    await waitFor(
      async () => attempts === 2 && (await monque.getJob(recurring._id))?.status === "pending",
    );
    expect((await monque.getJob(recurring._id))?.priority).toBe(-4);
    await monque.rescheduleJob(recurring._id.toHexString(), new Date());
    await waitFor(
      async () => attempts === 3 && (await monque.getJob(recurring._id))?.status === "pending",
    );
    expect(priorities).toEqual([-4, -4, -4]);
  });

  it.each(["stream", "polling", "local"] as const)(
    "priority edits wake pending work through %s notifications",
    async (mode) => {
      if (mode !== "stream")
        vi.spyOn(Collection.prototype, "watch").mockImplementation(() => {
          throw new Error("Streams unavailable");
        });
      const collectionName = uniqueCollectionName("priority-wakeup");
      const consumer = new Monque(db, {
        collectionName,
        pollInterval: mode === "polling" ? 20 : 60_000,
        safetyPollInterval: 60_000,
      });
      const producer = mode === "local" ? consumer : new Monque(db, { collectionName });
      instances.push(consumer);
      if (producer !== consumer) {
        instances.push(producer);
        await producer.initialize();
      }
      await consumer.initialize();
      const future = await producer.enqueue("work", "priority-edit", {
        runAt: new Date(Date.now() + 60_000),
      });
      const sentinel = await producer.now("ready", "ready");
      const received: unknown[] = [];
      consumer.register("work", (job) => {
        received.push(job.data);
      });
      consumer.register("ready", (job) => {
        received.push(job.data);
      });
      consumer.start();
      await waitFor(async () => (await producer.getJob(sentinel._id))?.status === "completed");
      // A replacement deliberately simulates a missed notification: only the following
      // priority-only update can wake the stream/local scheduler before its safety poll.
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (mode === "polling") {
        // Commit the edit before making the Job eligible so the fast poll cannot win first.
        const edited = await producer.setJobPriority(future._id.toHexString(), 6);
        await db
          .collection(collectionName)
          .replaceOne({ _id: future._id }, { ...edited!, nextRunAt: new Date(0) });
      } else {
        await db
          .collection(collectionName)
          .replaceOne({ _id: future._id }, { ...future, nextRunAt: new Date(0) });
        await producer.setJobPriority(future._id.toHexString(), 6);
      }
      await waitFor(async () => (await producer.getJob(future._id))?.status === "completed", {
        timeout: 3000,
        interval: 20,
      });
      expect(received).toEqual(["ready", "priority-edit"]);
      expect((await producer.getJob(future._id))?.priority).toBe(6);
    },
  );
  it("preserves edited priority through automatic retry and stale recovery", async () => {
    const collectionName = uniqueCollectionName("priority-recovery");
    const monque = new Monque(db, { collectionName, baseRetryInterval: 10 });
    instances.push(monque);
    await monque.initialize();
    const job = await monque.now("retry", {});
    await monque.setJobPriority(job._id.toHexString(), 11);
    const priorities: Array<number | undefined> = [];
    monque.register("retry", (current) => {
      priorities.push(current.priority);
      if (priorities.length === 1) throw new Error("retry once");
    });
    monque.start();
    await waitFor(async () => (await monque.getJob(job._id))?.status === "completed");
    expect(priorities).toEqual([11, 11]);
    const stale = await monque.now("recover", {});
    await monque.setJobPriority(stale._id.toHexString(), -6);
    await db.collection(collectionName).updateOne(
      { _id: stale._id },
      {
        $set: {
          status: "processing",
          claimedBy: "terminated-instance",
          claimId: "expired-claim",
          lockedAt: new Date(0),
          lastHeartbeat: new Date(0),
          heartbeatInterval: 1000,
        },
      },
    );
    const recovery = new Monque(db, { collectionName });
    instances.push(recovery);
    await recovery.initialize();
    const recovered = await recovery.getJob(stale._id);
    expect(recovered).toMatchObject({ status: "pending", priority: -6 });
    expect(recovered?.claimedBy).toBeUndefined();
  });
});
