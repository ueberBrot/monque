import { Collection, type Db, MongoServerError } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { Monque } from "@/scheduler";
import { getMongoClient } from "@tests/setup/mongodb";
import { cleanupTestDb, getTestDb, waitFor } from "@tests/setup/test-utils";

describe("transactional intake", () => {
  let db: Db;
  let monque: Monque;
  beforeEach(async () => {
    db = await getTestDb("transactions");
    await db.createCollection("orders");
    monque = new Monque(db, { pollInterval: 60_000, safetyPollInterval: 60_000 });
    await monque.initialize();
  });
  afterEach(async () => {
    await monque.stop();
    await cleanupTestDb(db);
    vi.restoreAllMocks();
  });

  it("publishes business data, a batch, and a recurring job only after commit", async () => {
    const processed: Array<[unknown, number | undefined]> = [];
    monque.register("work", async (job) => {
      processed.push([job.data, job.priority]);
    });
    monque.start();
    const client = await getMongoClient();
    await client.withSession(async (session) => {
      await session.withTransaction(async () => {
        await db.collection("orders").insertOne({ reference: "order-1" }, { session });
        const first = await monque.enqueue(
          "work",
          { id: 1 },
          { session, uniqueKey: "order-1", priority: 8 },
        );
        expect(
          (
            await monque.enqueue(
              "work",
              { id: 99 },
              { session, uniqueKey: "order-1", priority: 99 },
            )
          )._id,
        ).toEqual(first._id);
        expect(
          await monque.enqueueMany(
            [
              { name: "work", data: { id: 99 }, uniqueKey: "order-1", priority: 99 },
              { name: "work", data: { id: 2 }, priority: -3 },
            ],
            { session },
          ),
        ).toEqual({ insertedCount: 1, deduplicatedCount: 1 });
        await monque.schedule(
          "0 0 1 1 *",
          "annual",
          {},
          { session, timezone: "UTC", uniqueKey: "annual", priority: 12 },
        );
        expect(await db.collection("monque_jobs").countDocuments({}, { session })).toBe(3);
        expect(await db.collection("monque_jobs").countDocuments()).toBe(0);
        expect(await db.collection("orders").countDocuments()).toBe(0);
        expect(processed).toEqual([]);
      });
      expect(session.hasEnded).toBe(false);
    });
    await waitFor(async () => processed.length === 2, { timeout: 5000 });
    expect(processed).toEqual(
      expect.arrayContaining([
        [{ id: 1 }, 8],
        [{ id: 2 }, -3],
      ]),
    );
    expect(await db.collection("orders").countDocuments()).toBe(1);
    expect((await monque.getJobs({ name: "annual" }))[0]).toMatchObject({
      priority: 12,
      timezone: "UTC",
    });
    expect(await db.collection("monque_jobs").countDocuments({ session: { $exists: true } })).toBe(
      0,
    );
  });

  it("rolls back all jobs and business data when a batch write fails", async () => {
    await db.command({ collMod: "monque_jobs", validator: { "data.reject": { $ne: true } } });
    const client = await getMongoClient();
    await expect(
      client.withSession((session) =>
        session.withTransaction(async () => {
          await db.collection("orders").insertOne({ reference: "abort" }, { session });
          await monque.enqueue("work", { id: 1 }, { session, priority: 7 });
          await monque.schedule(
            "0 9 * * *",
            "aborted-report",
            {},
            { session, priority: -8, timezone: "UTC" },
          );
          await monque.enqueueMany(
            [
              { name: "work", data: { id: 2 }, priority: -3 },
              { name: "work", data: { reject: true } },
            ],
            { session },
          );
        }),
      ),
    ).rejects.toMatchObject({ code: 121 });
    expect(await db.collection("orders").countDocuments()).toBe(0);
    expect(await monque.getJobs()).toEqual([]);
  });

  it("preserves native error labels so withTransaction can retry the whole transaction", async () => {
    const transient = new MongoServerError({
      message: "Write conflict",
      code: 112,
      errorLabels: ["TransientTransactionError"],
    });
    const original = Collection.prototype.insertOne;
    let injected = false;
    vi.spyOn(Collection.prototype, "insertOne").mockImplementation(function (
      this: Collection,
      document,
      options,
    ) {
      if (this.collectionName === "monque_jobs" && !injected) {
        injected = true;
        return Promise.reject(transient);
      }
      return original.call(this, document, options);
    });
    let attempts = 0;
    const client = await getMongoClient();
    await client.withSession((session) =>
      session.withTransaction(async () => {
        attempts++;
        await db.collection("orders").insertOne({ reference: "retry" }, { session });
        await monque.enqueue("work", {}, { session, priority: 9 });
      }),
    );
    expect(attempts).toBe(2);
    expect(await db.collection("orders").countDocuments()).toBe(1);
    expect(await monque.getJobs()).toMatchObject([{ priority: 9 }]);
  });

  it.each(["batch", "recurring"] as const)(
    "preserves native transaction retry labels for prioritized %s writes",
    async (kind) => {
      const transient = new MongoServerError({
        message: "Write conflict",
        code: 112,
        errorLabels: ["TransientTransactionError"],
      });
      if (kind === "batch")
        vi.spyOn(Collection.prototype, "bulkWrite").mockRejectedValueOnce(transient);
      else vi.spyOn(Collection.prototype, "findOneAndUpdate").mockRejectedValueOnce(transient);
      let attempts = 0;
      const client = await getMongoClient();
      await client.withSession((session) =>
        session.withTransaction(async () => {
          attempts++;
          await monque.now("transaction-companion", {}, { session, priority: -1 });
          try {
            if (kind === "batch")
              await monque.enqueueMany([{ name: "work", data: {}, priority: 17 }], { session });
            else
              await monque.schedule(
                "0 9 * * *",
                "work",
                {},
                { session, priority: 17, uniqueKey: "recurring" },
              );
          } catch (error) {
            expect(error).toBe(transient);
            throw error;
          }
        }),
      );
      expect(attempts).toBe(2);
      expect(await monque.getJobs()).toMatchObject([{ priority: -1 }, { priority: 17 }]);
    },
  );
});
