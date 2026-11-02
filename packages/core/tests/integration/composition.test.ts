import type { Db } from "mongodb";
import { Binary, Decimal128, ObjectId } from "mongodb";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";

import { Monque } from "@/scheduler";
import {
  cleanupTestDb,
  clearCollection,
  getTestDb,
  stopMonqueInstances,
  uniqueCollectionName,
} from "@test-utils/test-utils.js";
import { JobFactory } from "@tests/factories";

describe("per-instance core composition", () => {
  let db: Db;
  let collectionName: string;
  const instances: Monque[] = [];

  beforeAll(async () => {
    db = await getTestDb("composition");
  });
  beforeEach(() => {
    collectionName = uniqueCollectionName("composition");
  });
  afterEach(async () => {
    await stopMonqueInstances(instances);
    await clearCollection(db, collectionName);
  });

  afterAll(async () => {
    await cleanupTestDb(db);
  });

  it("reads native BSON and legacy documents after stopping without closing the supplied Db", async () => {
    const monque = new Monque(db, { collectionName });
    instances.push(monque);
    await monque.initialize();

    const data = {
      reference: new ObjectId(),
      amount: Decimal128.fromString("1234.50"),
      bytes: new Binary(Buffer.from([0, 127, 255])),
      at: new Date("2026-01-02T03:04:05.000Z"),
    };

    const queued = await monque.enqueue("bson", data);

    const legacy = JobFactory.build({
      name: "legacy",
      data,
      repeatInterval: "0 * * * *",
      timezone: "Europe/Berlin",
    });

    await db.collection(collectionName).insertOne(legacy);
    await db
      .collection(collectionName)
      .updateOne({ _id: legacy._id }, { $unset: { priority: "" } });
    monque.pause();
    monque.start();
    await monque.stop();

    const read = await monque.getJob<typeof data>(queued._id.toHexString());
    expect(read).toStrictEqual(queued);
    expect({
      reference: read?.data.reference instanceof ObjectId,
      amount: read?.data.amount instanceof Decimal128,
      bytes: read?.data.bytes instanceof Binary,
      at: read?.data.at instanceof Date,
    }).toStrictEqual({ reference: true, amount: true, bytes: true, at: true });
    await expect(monque.getJob(legacy._id)).resolves.toStrictEqual({ ...legacy, priority: 0 });
    await expect(
      Promise.all([monque.getJob(new ObjectId()), monque.getJob("invalid-id")]),
    ).resolves.toStrictEqual([null, null]);
    await expect(db.command({ ping: 1 })).resolves.toMatchObject({ ok: 1 });
  });

  it("keeps BSON listing snapshots independent and all read interfaces usable after a run stops", async () => {
    const monque = new Monque(db, { collectionName });
    instances.push(monque);
    await monque.initialize();

    const data = {
      reference: new ObjectId(),
      amount: Decimal128.fromString("1234.50"),
      bytes: new Binary(Buffer.from([0, 127, 255])),
      at: new Date("2026-01-02T03:04:05.000Z"),
    };

    const queued = await monque.enqueue("bson", data);
    monque.pause();
    monque.start();
    await monque.stop();

    const [first, second, page, summaries] = await Promise.all([
      monque.getJobs<typeof data>({ name: "bson" }),
      monque.getJobs<typeof data>({ name: "bson" }),
      monque.getJobsWithCursor<typeof data>({ filter: { name: "bson" } }),
      monque.getJobSummariesWithCursor({ filter: { name: "bson" } }),
    ]);

    expect({ first, second, pageJobs: page.jobs }).toStrictEqual({
      first: [queued],
      second: [queued],
      pageJobs: [queued],
    });
    expect(summaries).toMatchObject({
      cursor: page.cursor,
      jobs: [{ _id: queued._id, name: "bson", priority: 0 }],
    });
    expect(summaries.jobs[0]).not.toHaveProperty("data");
    const [firstJob] = first;

    if (!firstJob) {
      throw new Error("Expected persisted Job");
    }

    firstJob.data.at.setFullYear(2000);
    firstJob.data.bytes.buffer[0] = 42;
    expect({
      at: second[0]?.data.at.toISOString(),
      byte: second[0]?.data.bytes.buffer[0],
    }).toStrictEqual({ at: "2026-01-02T03:04:05.000Z", byte: 0 });

    const [stats, views] = await Promise.all([
      monque.getQueueStats({ name: "bson" }),
      monque.getQueueViewSummaries({ name: "bson" }),
    ]);

    expect({ stats, views }).toMatchObject({
      stats: { pending: 1, total: 1 },
      views: [{ name: "bson", stats: { pending: 1, total: 1 } }],
    });
  });

  it("keeps registration and immediate controls isolated for instances sharing a collection", async () => {
    const first = new Monque(db, { collectionName });
    const second = new Monque(db, { collectionName });
    instances.push(first, second);
    first.register("work", async () => {}, { concurrency: 2 });
    second.register("work", async () => {}, { concurrency: 7 });
    first.pause();
    second.pause("work");
    await Promise.all([first.initialize(), second.initialize(), first.initialize()]);
    expect([first.isHealthy(), second.isHealthy()]).toStrictEqual([false, false]);

    await expect(
      Promise.all([first.getQueueViewSummaries(), second.getQueueViewSummaries()]),
    ).resolves.toMatchObject([
      [{ worker: { concurrency: 2, activeCount: 0, paused: true } }],
      [{ worker: { concurrency: 7, activeCount: 0, paused: true } }],
    ]);
    first.start();
    first.resume();
    expect({
      healthy: [first.isHealthy(), second.isHealthy()],
      paused: [first.isPaused(), first.isPaused("work"), second.isPaused("work")],
    }).toStrictEqual({ healthy: [true, false], paused: [false, false, true] });
    second.start();
    await first.stop();
    expect([first.isHealthy(), second.isHealthy()]).toStrictEqual([false, true]);
    await expect(
      Promise.all([first.getQueueViewSummaries(), second.getQueueViewSummaries()]),
    ).resolves.toMatchObject([
      [{ worker: { concurrency: 2, activeCount: 0, paused: false } }],
      [{ worker: { concurrency: 7, activeCount: 0, paused: true } }],
    ]);
  });
});
