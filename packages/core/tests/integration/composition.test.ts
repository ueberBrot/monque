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
