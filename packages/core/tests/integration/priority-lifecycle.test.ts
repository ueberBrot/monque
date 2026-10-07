import { type Db, MongoBulkWriteError, ObjectId } from "mongodb";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { ConnectionError, InvalidJobPriorityError, JobStatus, Monque } from "@/index";
import {
  cleanupTestDb,
  getTestDb,
  stopMonqueInstances,
  uniqueCollectionName,
  waitFor,
} from "@test-utils/test-utils";

describe("priority across Job intake and lifecycle", () => {
  let db: Db;
  const instances: Monque[] = [];
  beforeAll(async () => {
    db = await getTestDb("priority-lifecycle");
  });
  afterEach(async () => {
    await stopMonqueInstances(instances);
    vi.useRealTimers();
  });
  afterAll(async () => {
    await cleanupTestDb(db);
  });

  it("persists recurring priority and rejects invalid values before any write", async () => {
    const monque = new Monque(db, { collectionName: uniqueCollectionName("recurring") });
    instances.push(monque);
    await monque.initialize();
    for (const priority of [
      "1",
      null,
      true,
      {},
      0.5,
      NaN,
      Infinity,
      -Infinity,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      await expect(
        monque.schedule("0 9 * * *", "report", {}, { priority: priority as number }),
      ).rejects.toBeInstanceOf(InvalidJobPriorityError);
    }
    expect(await monque.getJobs()).toEqual([]);
    const job = await monque.schedule(
      "0 9 * * *",
      "report",
      {},
      { priority: -7, timezone: "Europe/Berlin" },
    );
    expect(job.priority).toBe(-7);
    expect(await monque.getJob(job._id)).toMatchObject({ priority: -7, timezone: "Europe/Berlin" });
  });

  it("validates the whole batch before writing and claims mixed priorities in order", async () => {
    const monque = new Monque(db, {
      collectionName: uniqueCollectionName("batch"),
      workerConcurrency: 1,
    });
    instances.push(monque);
    await monque.initialize();
    for (const priority of [
      "1",
      null,
      true,
      {},
      0.5,
      NaN,
      Infinity,
      -Infinity,
      Number.MIN_SAFE_INTEGER - 1,
    ]) {
      await expect(
        monque.enqueueMany([
          { name: "work", data: "valid", priority: 10 },
          { name: "work", data: "invalid", priority: priority as number },
        ]),
      ).rejects.toBeInstanceOf(InvalidJobPriorityError);
      expect(await monque.getJobs()).toEqual([]);
    }
    const runAt = new Date(0);
    expect(
      await monque.enqueueMany([
        { name: "work", data: "background", priority: -4, runAt },
        { name: "work", data: "zero", priority: 0, runAt },
        { name: "work", data: "urgent", priority: 12, runAt },
        { name: "work", data: "default", runAt },
      ]),
    ).toEqual({ insertedCount: 4, deduplicatedCount: 0 });
    const seen: Array<[unknown, number | undefined]> = [];
    const events: Array<number | undefined> = [];
    monque.on("job:complete", ({ job }) => {
      events.push(job.priority);
    });
    monque.register("work", (job) => {
      seen.push([job.data, job.priority]);
    });
    monque.start();
    await waitFor(async () => events.length === 4);
    expect(seen).toEqual([
      ["urgent", 12],
      ["zero", 0],
      ["default", 0],
      ["background", -4],
    ]);
    expect(events).toEqual([12, 0, 0, -4]);
  });

  it("retains the active Job's payload, schedule and priority for single, batch and recurring duplicates", async () => {
    const monque = new Monque(db, { collectionName: uniqueCollectionName("duplicates") });
    instances.push(monque);
    await monque.initialize();
    const original = await monque.schedule(
      "0 9 * * *",
      "work",
      { original: true },
      {
        priority: -8,
        timezone: "Europe/Berlin",
        uniqueKey: "active",
      },
    );
    expect(
      await monque.schedule(
        "0 10 * * *",
        "work",
        { replacement: true },
        {
          priority: 99,
          timezone: "UTC",
          uniqueKey: "active",
        },
      ),
    ).toEqual(original);
    expect(await monque.enqueue("work", {}, { priority: 100, uniqueKey: "active" })).toEqual(
      original,
    );
    expect(
      await monque.enqueueMany([
        { name: "work", data: {}, priority: 101, uniqueKey: "active" },
        { name: "work", data: {}, priority: 102, uniqueKey: "active" },
        { name: "work", data: {}, priority: 7, uniqueKey: "new" },
      ]),
    ).toEqual({ insertedCount: 1, deduplicatedCount: 2 });
    expect(await monque.getJob(original._id)).toEqual(original);
  });

  it("preserves priorities and partial database error results for an unordered batch", async () => {
    const collectionName = uniqueCollectionName("partial");
    const monque = new Monque(db, { collectionName });
    instances.push(monque);
    await monque.initialize();
    await db.command({ collMod: collectionName, validator: { "data.reject": { $ne: true } } });
    let failure: unknown;
    try {
      await monque.enqueueMany([
        { name: "work", data: { label: "first" }, priority: -4 },
        { name: "work", data: { reject: true }, priority: 100 },
        { name: "work", data: { label: "last" }, priority: 9 },
      ]);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ConnectionError);
    if (!(failure instanceof ConnectionError) || !(failure.cause instanceof MongoBulkWriteError))
      throw new Error("Expected native bulk result");
    expect(failure.cause.result.upsertedCount).toBe(2);
    expect(failure.cause.writeErrors).toMatchObject([{ index: 1, code: 121 }]);
    expect(await monque.getJobs()).toMatchObject([
      { data: { label: "first" }, priority: -4 },
      { data: { label: "last" }, priority: 9 },
    ]);
  });

  it("retains recurring priority through automatic retry and the next run across DST", async () => {
    const monque = new Monque(db, {
      collectionName: uniqueCollectionName("recurring-runs"),
      pollInterval: 20,
    });
    instances.push(monque);
    await monque.initialize();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-28T00:00:00Z"));
    const job = await monque.schedule(
      "0 9 * * *",
      "report",
      {},
      { priority: 15, timezone: "Europe/Berlin" },
    );
    const seen: Array<number | undefined> = [];
    monque.register("report", (job) => {
      seen.push(job.priority);
      if (seen.length === 1) throw new Error("Temporary failure");
    });
    const failures: Array<number | undefined> = [];
    const completions: Array<number | undefined> = [];
    monque.on("job:fail", ({ job }) => {
      failures.push(job.priority);
    });
    monque.on("job:complete", ({ job }) => {
      completions.push(job.priority);
    });
    vi.setSystemTime(job.nextRunAt);
    monque.start();
    await waitFor(async () => failures.length === 1);
    const retry = await monque.getJob(job._id);
    expect(retry).toMatchObject({
      priority: 15,
      timezone: "Europe/Berlin",
      status: "pending",
      failCount: 1,
    });
    vi.setSystemTime(retry!.nextRunAt);
    await waitFor(async () => completions.length === 1);
    const next = await monque.getJob(job._id);
    expect(next).toMatchObject({
      priority: 15,
      timezone: "Europe/Berlin",
      status: "pending",
      failCount: 0,
      nextRunAt: new Date("2026-03-29T07:00:00Z"),
    });
    vi.setSystemTime(next!.nextRunAt);
    await waitFor(async () => completions.length === 2);
    expect(seen).toEqual([15, 15, 15]);
    expect(failures).toEqual([15]);
    expect(completions).toEqual([15, 15]);
    expect((await monque.getJobSummariesWithCursor()).jobs[0]).toMatchObject({
      priority: 15,
      nextRunAt: new Date("2026-03-30T07:00:00Z"),
    });
  });

  it("retains priority through manual single and bulk retry, rescheduling and completion", async () => {
    const monque = new Monque(db, {
      collectionName: uniqueCollectionName("manual"),
      maxRetries: 0,
    });
    instances.push(monque);
    await monque.initialize();
    const job = await monque.now("work", {}, { priority: -6 });
    let attempts = 0;
    monque.register("work", () => {
      if (++attempts === 1) throw new Error("Failed");
    });
    monque.start();
    await waitFor(async () => (await monque.getJob(job._id))?.status === JobStatus.FAILED);
    monque.pause();
    expect(await monque.retryJob(job._id.toHexString())).toMatchObject({
      priority: -6,
      status: "pending",
      failCount: 0,
    });
    await monque.cancelJob(job._id.toHexString());
    expect(await monque.retryJobs({ name: "work" })).toMatchObject({ count: 1, errors: [] });
    expect(await monque.rescheduleJob(job._id.toHexString(), new Date(0))).toMatchObject({
      priority: -6,
      status: "pending",
      failCount: 0,
    });
    monque.resume();
    await waitFor(async () => (await monque.getJob(job._id))?.status === JobStatus.COMPLETED);
    const completed = await monque.getJob(job._id);
    expect(completed).toMatchObject({ priority: -6, status: "completed", failCount: 0 });
    expect(completed).not.toHaveProperty("claimId");
    expect(completed).not.toHaveProperty("claimedBy");
  });

  it("retains priority while stale recovery clears ownership and makes work claimable again", async () => {
    const collectionName = uniqueCollectionName("stale");
    const id = new ObjectId();
    const timestamp = new Date(Date.now() - 60_000);
    await db.collection(collectionName).insertOne({
      _id: id,
      name: "work",
      data: {},
      priority: 23,
      status: "processing",
      failCount: 2,
      nextRunAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
      lockedAt: timestamp,
      claimedBy: "crashed",
      claimId: "stale-claim",
      lastHeartbeat: timestamp,
    });
    const monque = new Monque(db, { collectionName, lockTimeout: 1000 });
    instances.push(monque);
    await monque.initialize();
    const recovered = await monque.getJob(id);
    expect(recovered).toMatchObject({ priority: 23, status: "pending", failCount: 2 });
    expect(recovered).not.toHaveProperty("claimedBy");
    expect(recovered).not.toHaveProperty("claimId");
    let handledPriority: number | undefined;
    monque.register("work", (job) => {
      handledPriority = job.priority;
    });
    monque.start();
    await waitFor(async () => (await monque.getJob(id))?.status === JobStatus.COMPLETED);
    expect(handledPriority).toBe(23);
    expect((await monque.getJob(id))?.priority).toBe(23);
  });
});
