import { fromAny } from "@total-typescript/shoehorn";
import { MongoBulkWriteError, ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { ConnectionError, InvalidJobPriorityError, JobStatus, Monque } from "@/index";
import {
  cleanupTestDb,
  getTestDb,
  stopMonqueInstances,
  uniqueCollectionName,
  waitFor,
} from "@test-utils/test-utils";

import { requireValue, forEachSequential } from "./helpers";

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
    await forEachSequential(
      ["1", null, true, {}, 0.5, Number.NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1],
      async (priority) => {
        await expect(
          monque.schedule(
            "0 9 * * *",
            "report",
            {},
            { priority: fromAny<number, unknown>(priority) },
          ),
        ).rejects.toBeInstanceOf(InvalidJobPriorityError);
      },
    );
    await expect(monque.getJobs()).resolves.toStrictEqual([]);
    const job = await monque.schedule(
      "0 9 * * *",
      "report",
      {},
      { priority: -7, timezone: "Europe/Berlin" },
    );
    expect(job.priority).toBe(-7);
    await expect(monque.getJob(job._id)).resolves.toMatchObject({
      priority: -7,
      timezone: "Europe/Berlin",
    });
  });

  it("validates the whole batch before writing and claims mixed priorities in order", async () => {
    const monque = new Monque(db, {
      collectionName: uniqueCollectionName("batch"),
      workerConcurrency: 1,
    });
    instances.push(monque);
    await monque.initialize();
    await forEachSequential(
      ["1", null, true, {}, 0.5, Number.NaN, Infinity, -Infinity, Number.MIN_SAFE_INTEGER - 1],
      async (priority) => {
        await expect(
          monque.enqueueMany([
            { name: "work", data: "valid", priority: 10 },
            { name: "work", data: "invalid", priority: fromAny<number, unknown>(priority) },
          ]),
        ).rejects.toBeInstanceOf(InvalidJobPriorityError);
        await expect(monque.getJobs()).resolves.toStrictEqual([]);
      },
    );
    const runAt = new Date(0);
    await expect(
      monque.enqueueMany([
        { name: "work", data: "background", priority: -4, runAt },
        { name: "work", data: "zero", priority: 0, runAt },
        { name: "work", data: "urgent", priority: 12, runAt },
        { name: "work", data: "default", runAt },
      ]),
    ).resolves.toStrictEqual({ insertedCount: 4, deduplicatedCount: 0 });
    const seen: [unknown, number | undefined][] = [];
    const events: (number | undefined)[] = [];
    monque.on("job:complete", ({ job }) => {
      events.push(job.priority);
    });
    monque.register("work", (job) => {
      seen.push([job.data, job.priority]);
    });
    monque.start();
    await waitFor(() => events.length === 4);
    expect({
      seen,
      events,
    }).toStrictEqual({
      seen: [
        ["urgent", 12],
        ["zero", 0],
        ["default", 0],
        ["background", -4],
      ],
      events: [12, 0, 0, -4],
    });
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
    await expect(
      monque.schedule(
        "0 10 * * *",
        "work",
        { replacement: true },
        {
          priority: 99,
          timezone: "UTC",
          uniqueKey: "active",
        },
      ),
    ).resolves.toStrictEqual(original);
    await expect(
      monque.enqueue("work", {}, { priority: 100, uniqueKey: "active" }),
    ).resolves.toStrictEqual(original);
    await expect(
      monque.enqueueMany([
        { name: "work", data: {}, priority: 101, uniqueKey: "active" },
        { name: "work", data: {}, priority: 102, uniqueKey: "active" },
        { name: "work", data: {}, priority: 7, uniqueKey: "new" },
      ]),
    ).resolves.toStrictEqual({ insertedCount: 1, deduplicatedCount: 2 });
    await expect(monque.getJob(original._id)).resolves.toStrictEqual(original);
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
    if (!(failure instanceof ConnectionError) || !(failure.cause instanceof MongoBulkWriteError)) {
      throw new Error("Expected native bulk result");
    }
    expect(failure.cause.result.upsertedCount).toBe(2);
    expect(failure.cause.writeErrors).toMatchObject([{ index: 1, code: 121 }]);
    await expect(monque.getJobs()).resolves.toMatchObject([
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
    const seen: (number | undefined)[] = [];
    monque.register("report", (reportJob) => {
      seen.push(reportJob.priority);
      if (seen.length === 1) {
        throw new Error("Temporary failure");
      }
    });
    const failures: (number | undefined)[] = [];
    const completions: (number | undefined)[] = [];
    monque.on("job:fail", ({ job: failedJob }) => {
      failures.push(failedJob.priority);
    });
    monque.on("job:complete", ({ job: completedJob }) => {
      completions.push(completedJob.priority);
    });
    vi.setSystemTime(job.nextRunAt);
    monque.start();
    await waitFor(() => failures.length === 1);
    const retry = await monque.getJob(job._id);
    expect(retry).toMatchObject({
      priority: 15,
      timezone: "Europe/Berlin",
      status: "pending",
      failCount: 1,
    });
    vi.setSystemTime(requireValue(retry).nextRunAt);
    await waitFor(() => completions.length === 1);
    const next = await monque.getJob(job._id);
    expect(next).toMatchObject({
      priority: 15,
      timezone: "Europe/Berlin",
      status: "pending",
      failCount: 0,
      nextRunAt: new Date("2026-03-29T07:00:00Z"),
    });
    vi.setSystemTime(requireValue(next).nextRunAt);
    await waitFor(() => completions.length === 2);
    expect({
      seen,
      failures,
      completions,
    }).toStrictEqual({
      seen: [15, 15, 15],
      failures: [15],
      completions: [15, 15],
    });
    const awaitedResult1 = await monque.getJobSummariesWithCursor();
    expect(awaitedResult1.jobs[0]).toMatchObject({
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
      if ((attempts += 1) === 1) {
        throw new Error("Failed");
      }
    });
    monque.start();
    await waitFor(async () => {
      const awaitedResult2 = await monque.getJob(job._id);
      return awaitedResult2?.status === JobStatus.FAILED;
    });
    monque.pause();
    await expect(monque.retryJob(job._id.toHexString())).resolves.toMatchObject({
      priority: -6,
      status: "pending",
      failCount: 0,
    });
    await monque.cancelJob(job._id.toHexString());
    await expect(monque.retryJobs({ name: "work" })).resolves.toMatchObject({
      count: 1,
      errors: [],
    });
    await expect(monque.rescheduleJob(job._id.toHexString(), new Date(0))).resolves.toMatchObject({
      priority: -6,
      status: "pending",
      failCount: 0,
    });
    monque.resume();
    await waitFor(async () => {
      const awaitedResult3 = await monque.getJob(job._id);
      return awaitedResult3?.status === JobStatus.COMPLETED;
    });
    const completed = await monque.getJob(job._id);
    expect(completed).toMatchObject({ priority: -6, status: "completed", failCount: 0 });
    expect({
      hasClaimId: Object.hasOwn(completed ?? {}, "claimId"),
      hasClaimedBy: Object.hasOwn(completed ?? {}, "claimedBy"),
    }).toStrictEqual({ hasClaimId: false, hasClaimedBy: false });
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
    await waitFor(async () => {
      const awaitedResult4 = await monque.getJob(id);
      return awaitedResult4?.status === JobStatus.COMPLETED;
    });
    expect(handledPriority).toBe(23);
    const awaitedResult5 = await monque.getJob(id);
    expect(awaitedResult5?.priority).toBe(23);
  });
});
