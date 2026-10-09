import { fromAny } from "@total-typescript/shoehorn";
import { Collection, ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { Monque } from "@/index";
import {
  cleanupTestDb,
  getTestDb,
  stopMonqueInstances,
  uniqueCollectionName,
  waitFor,
} from "@test-utils/test-utils";
import { getMongoClient } from "@tests/setup/mongodb";

import { requireValue, forEachSequential } from "./helpers";

describe("Job priorities", () => {
  let db: Db;
  const instances: Monque[] = [];
  beforeAll(async () => {
    db = await getTestDb("priority");
  });
  afterEach(async () => {
    await stopMonqueInstances(instances);
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await cleanupTestDb(db);
  });

  it("exposes explicit and default priorities through single intake and public reads", async () => {
    const monque = new Monque(db, { collectionName: uniqueCollectionName("priority") });
    instances.push(monque);
    await monque.initialize();
    await forEachSequential(
      [7, 0, -3, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, undefined],
      async (priority) => {
        const before = Date.now();
        const job = await monque.now("work", {}, priority === undefined ? {} : { priority });
        expect(job.priority).toBe(priority ?? 0);
        expect(job.nextRunAt.getTime()).toBeGreaterThanOrEqual(before);
        expect(job.nextRunAt.getTime()).toBeLessThanOrEqual(Date.now());
        const awaitedResult1 = await monque.getJob(job._id);
        expect(awaitedResult1?.priority).toBe(priority ?? 0);
      },
    );
    const awaitedResult2 = await monque.getJobSummariesWithCursor();
    expect(awaitedResult2.jobs.map((job) => job.priority)).toStrictEqual([
      7,
      0,
      -3,
      Number.MIN_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER,
      0,
    ]);
  });

  it("rejects invalid runtime priorities before creating any Jobs", async () => {
    const monque = new Monque(db, { collectionName: uniqueCollectionName("invalid-priority") });
    instances.push(monque);
    await monque.initialize();
    await forEachSequential(
      ["1", null, true, {}, 0.5, Number.NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1],
      async (priority) => {
        await expect(
          monque.enqueue("work", {}, { priority: fromAny<number, unknown>(priority) }),
        ).rejects.toThrow("Priority must be a signed safe integer");
      },
    );
    await expect(monque.getJobs()).resolves.toStrictEqual([]);
  });

  it.each([false, true])(
    "claims urgent, default and legacy Jobs ahead of negative priorities (user indexes: %s)",
    async (skipIndexCreation) => {
      const collectionName = uniqueCollectionName("legacy-priority");
      const timestamp = new Date("2025-01-01T00:00:00Z");
      const legacy = {
        _id: new ObjectId("000000000000000000000002"),
        name: "work",
        data: { label: "legacy" },
        status: "pending",
        nextRunAt: timestamp,
        failCount: 2,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await db.collection(collectionName).insertOne(legacy);
      const monque = new Monque(db, { collectionName, skipIndexCreation, workerConcurrency: 1 });
      instances.push(monque);
      await monque.initialize();
      await expect(monque.getJob(legacy._id)).resolves.toStrictEqual({ ...legacy, priority: 0 });
      await expect(
        db.collection(collectionName).findOne({ _id: legacy._id }),
      ).resolves.toStrictEqual({
        ...legacy,
        priority: 0,
      });
      const again = new Monque(db, { collectionName, skipIndexCreation });
      instances.push(again);
      await again.initialize();
      await expect(again.getJob(legacy._id)).resolves.toStrictEqual({ ...legacy, priority: 0 });
      await monque.enqueue("work", { label: "negative" }, { priority: -3, runAt: new Date(0) });
      await monque.enqueue("work", { label: "normal" }, { runAt: timestamp });
      await monque.enqueue("work", { label: "urgent" }, { priority: 7 });
      const received: string[] = [];
      const emitted: number[] = [];
      monque.on("job:start", (job) => {
        emitted.push(job.priority ?? Number.NaN);
      });
      monque.register<{
        label: string;
      }>("work", (job) => {
        received.push(job.data.label);
      });
      monque.start();
      await waitFor(() => received.length === 4);
      expect({
        received,
        emitted,
      }).toStrictEqual({
        received: ["urgent", "legacy", "normal", "negative"],
        emitted: [7, 0, 0, -3],
      });
    },
  );

  it("persists default priority on recurring and batch Jobs and leaves duplicates unchanged", async () => {
    const collectionName = uniqueCollectionName("default-priority");
    const monque = new Monque(db, { collectionName });
    instances.push(monque);
    await monque.initialize();
    const runAt = new Date(Date.now() + 60_000);
    const original = await monque.enqueue(
      "work",
      { original: true },
      { priority: -5, uniqueKey: "active", runAt },
    );
    await expect(
      monque.enqueue("work", { replacement: true }, { priority: 10, uniqueKey: "active" }),
    ).resolves.toStrictEqual(original);
    const scheduled = await monque.schedule("0 * * * *", "recurring", {});
    expect(scheduled.priority).toBe(0);
    const awaitedResult3 = await db.collection(collectionName).findOne({ _id: scheduled._id });
    expect(awaitedResult3?.["priority"]).toBe(0);
    await monque.enqueueMany([{ name: "batch", data: {} }]);
    const awaitedResult4 = await monque.getJobs({ name: "batch" });
    expect(awaitedResult4[0]?.priority).toBe(0);
  });

  it("breaks equal-priority ties by due time then identifier, independently of insertion order", async () => {
    const collectionName = uniqueCollectionName("ties");
    const now = new Date();
    await db.collection(collectionName).insertMany(
      [3, 2, 1].map((id) => ({
        _id: new ObjectId(id.toString().padStart(24, "0")),
        name: "work",
        data: id,
        priority: 2,
        status: "pending",
        nextRunAt: new Date(now.getTime() - (id === 3 ? 10_000 : 1000)),
        failCount: 0,
        createdAt: now,
        updatedAt: now,
      })),
    );
    const monque = new Monque(db, { collectionName, workerConcurrency: 1 });
    instances.push(monque);
    await monque.initialize();
    const received: unknown[] = [];
    monque.register("work", (job) => {
      received.push(job.data);
    });
    monque.start();
    await waitFor(() => received.length === 3);
    expect(received).toStrictEqual([3, 1, 2]);
  });

  it.each([false, true])(
    "discovers due lower priorities beside future urgent work and wakes at deadlines (polling: %s)",
    async (polling) => {
      if (polling) {
        vi.spyOn(Collection.prototype, "watch").mockImplementation(() => {
          throw new Error("Change Streams unavailable");
        });
      }
      const collectionName = uniqueCollectionName("due-priority");
      const producer = new Monque(db, { collectionName });
      const consumer = new Monque(db, {
        collectionName,
        workerConcurrency: 1,
        pollInterval: polling ? 20 : 60_000,
        safetyPollInterval: 60_000,
      });
      instances.push(producer, consumer);
      await producer.initialize();
      await consumer.initialize();
      const received: unknown[] = [];
      let futureStart = 0;
      consumer.register("work", (job) => {
        received.push(job.data);
        if (job.data === "future") {
          futureStart = Date.now();
        }
      });
      const runAt = new Date(Date.now() + 1000);
      await producer.enqueue("work", "future", { priority: 100, runAt });
      await producer.enqueue("work", "due", { priority: -5 });
      consumer.start();
      await waitFor(() => received.length === 2, { timeout: 5000, interval: 10 });
      expect(received).toStrictEqual(["due", "future"]);
      expect(futureStart).toBeGreaterThanOrEqual(runAt.getTime());
      await producer.enqueue("work", "external", { priority: 25 });
      await waitFor(() => received.length === 3, { timeout: 5000, interval: 10 });
      expect(received[2]).toBe("external");
    },
  );

  it("keeps priority scoped to a Job Name under shared capacity and collection collation", async () => {
    const collectionName = uniqueCollectionName("fair-priority");
    await db.createCollection(collectionName, { collation: { locale: "en", strength: 2 } });
    const monque = new Monque(db, { collectionName, instanceConcurrency: 1 });
    instances.push(monque);
    await monque.initialize();
    const received: unknown[] = [];
    for (const name of ["email", "other"]) {
      monque.register(name, (job) => {
        received.push(job.data);
      });
    }
    await monque.enqueue("EMAIL", "routine", { priority: 1 });
    await monque.enqueue("EMAIL", "urgent", { priority: 100 });
    await monque.enqueue("other", "other", { priority: -100 });
    monque.start();
    await waitFor(() => received.length === 3);
    expect(received).toStrictEqual(["urgent", "other", "routine"]);
  });

  it("retains one atomic owner per Job across concurrent prioritized consumers", async () => {
    const collectionName = uniqueCollectionName("owners-priority");
    const consumers = ["priority-owner-1", "priority-owner-2"].map(
      (schedulerInstanceId) => new Monque(db, { collectionName, schedulerInstanceId }),
    );
    instances.push(...consumers);
    await Promise.all(
      consumers.map(async (consumer) => {
        await consumer.initialize();
      }),
    );
    const claims: string[] = [];
    const ids: string[] = [];
    for (const [index, consumer] of consumers.entries()) {
      consumer.register("work", (job) => {
        expect(job.claimedBy).toBe(`priority-owner-${index + 1}`);
        expect(job.claimId).toBeTypeOf("string");
        claims.push(requireValue(job.claimId));
        ids.push(requireValue(job._id).toHexString());
      });
    }
    await forEachSequential(
      Array.from({ length: Math.ceil(20 / 1) }, (_, index) => index * 1),
      async (index) => {
        await requireValue(consumers[0]).enqueue("work", {}, { priority: index - 10 });
      },
    );
    for (const consumer of consumers) {
      consumer.start();
    }
    await waitFor(() => ids.length === 20);
    expect({
      newSetIdsSize: new Set(ids).size,
      newSetClaimsSize: new Set(claims).size,
    }).toStrictEqual({
      newSetIdsSize: 20,
      newSetClaimsSize: 20,
    });
  });

  it("keeps caller-owned transaction commit and rollback behavior for prioritized single writes", async () => {
    const monque = new Monque(db, { collectionName: uniqueCollectionName("priority-transaction") });
    instances.push(monque);
    await monque.initialize();
    const client = await getMongoClient();
    await client.withSession(async (session) => {
      await session.withTransaction(async () => {
        await monque.enqueue("work", "enqueued", { priority: -4, session });
        await monque.now("work", "immediate", { priority: 9, session });
        await expect(monque.getJobs()).resolves.toStrictEqual([]);
      });
      expect(session.hasEnded).toBe(false);
    });
    const awaitedResult5 = await monque.getJobs();
    expect(awaitedResult5.map((job) => job.priority)).toStrictEqual([-4, 9]);
    await client.withSession(async (session) => {
      session.startTransaction();
      await monque.now("work", "aborted", { priority: 100, session });
      await session.abortTransaction();
      expect(session.hasEnded).toBe(false);
    });
    const awaitedResult6 = await monque.getJobs();
    expect(awaitedResult6.map((job) => job.data)).toStrictEqual(["enqueued", "immediate"]);
  });

  it("normalizes legacy ownership metadata without rewriting lifecycle fields or explicit priorities", async () => {
    const collectionName = uniqueCollectionName("priority-metadata");
    const now = new Date();
    const owned = {
      _id: new ObjectId(),
      name: "work",
      data: {},
      status: "processing",
      nextRunAt: now,
      failCount: 3,
      failReason: "retained",
      createdAt: now,
      updatedAt: now,
      lockedAt: now,
      lastHeartbeat: now,
      heartbeatInterval: 30_000,
      claimedBy: "other-instance",
      claimId: "other-claim",
    };
    const explicit = { ...owned, _id: new ObjectId(), status: "completed", priority: -9 };
    await db.collection(collectionName).insertMany([owned, explicit]);
    await forEachSequential(
      Array.from({ length: Math.ceil(2 / 1) }, (_, index) => index * 1),
      async (_i) => {
        const monque = new Monque(db, { collectionName });
        instances.push(monque);
        await monque.initialize();
        await expect(monque.getJob(owned._id)).resolves.toStrictEqual({ ...owned, priority: 0 });
        await expect(monque.getJob(explicit._id)).resolves.toStrictEqual(explicit);
      },
    );
  });
});
