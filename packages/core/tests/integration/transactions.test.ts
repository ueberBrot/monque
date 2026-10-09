import { Collection, MongoServerError } from "mongodb";
import type { Db } from "mongodb";
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
    const processed: [unknown, number | undefined][] = [];
    monque.register("work", (job) => {
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
        const awaitedResult1 = await monque.enqueue(
          "work",
          { id: 99 },
          { session, uniqueKey: "order-1", priority: 99 },
        );
        expect(awaitedResult1._id).toStrictEqual(first._id);
        await expect(
          monque.enqueueMany(
            [
              { name: "work", data: { id: 99 }, uniqueKey: "order-1", priority: 99 },
              { name: "work", data: { id: 2 }, priority: -3 },
            ],
            { session },
          ),
        ).resolves.toStrictEqual({ insertedCount: 1, deduplicatedCount: 1 });
        await monque.schedule(
          "0 0 1 1 *",
          "annual",
          {},
          { session, timezone: "UTC", uniqueKey: "annual", priority: 12 },
        );
        expect({
          transactionJobCount: await db.collection("monque_jobs").countDocuments({}, { session }),
          visibleJobCount: await db.collection("monque_jobs").countDocuments(),
          visibleOrderCount: await db.collection("orders").countDocuments(),
          processed,
          sessionEnded: session.hasEnded,
        }).toStrictEqual({
          transactionJobCount: 3,
          visibleJobCount: 0,
          visibleOrderCount: 0,
          processed: [],
          sessionEnded: false,
        });
      });
    });
    await waitFor(() => processed.length === 2, { timeout: 5000 });
    expect(processed).toStrictEqual(
      expect.arrayContaining([
        [{ id: 1 }, 8],
        [{ id: 2 }, -3],
      ]),
    );
    await expect(db.collection("orders").countDocuments()).resolves.toBe(1);
    const awaitedResult2 = await monque.getJobs({ name: "annual" });
    expect(awaitedResult2[0]).toMatchObject({
      priority: 12,
      timezone: "UTC",
    });
    await expect(
      db.collection("monque_jobs").countDocuments({ session: { $exists: true } }),
    ).resolves.toBe(0);
  });

  it("rolls back all jobs and business data when a batch write fails", async () => {
    await db.command({ collMod: "monque_jobs", validator: { "data.reject": { $ne: true } } });
    const client = await getMongoClient();
    await expect(
      client.withSession(async (session) => {
        await session.withTransaction(async () => {
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
        });
      }),
    ).rejects.toMatchObject({ code: 121 });
    await expect(db.collection("orders").countDocuments()).resolves.toBe(0);
    await expect(monque.getJobs()).resolves.toStrictEqual([]);
  });

  it("preserves native error labels so withTransaction can retry the whole transaction", async () => {
    const transient = new MongoServerError({
      message: "Write conflict",
      code: 112,
      errorLabels: ["TransientTransactionError"],
    });
    // oxlint-disable-next-line typescript/unbound-method -- The original prototype method is invoked with its collection receiver through call.
    const original = Collection.prototype.insertOne;
    let injected = false;
    vi.spyOn(Collection.prototype, "insertOne").mockImplementation(async function insertOne(
      this: Collection,
      document,
      options,
    ) {
      if (this.collectionName === "monque_jobs" && !injected) {
        injected = true;
        throw transient;
      }
      return await original.call(this, document, options);
    });
    let attempts = 0;
    const client = await getMongoClient();
    await client.withSession(async (session) => {
      await session.withTransaction(async () => {
        attempts += 1;
        await db.collection("orders").insertOne({ reference: "retry" }, { session });
        await monque.enqueue("work", {}, { session, priority: 9 });
      });
    });
    expect(attempts).toBe(2);
    await expect(db.collection("orders").countDocuments()).resolves.toBe(1);
    await expect(monque.getJobs()).resolves.toMatchObject([{ priority: 9 }]);
  });

  it.each(["batch", "recurring"] as const)(
    "preserves native transaction retry labels for prioritized %s writes",
    async (kind) => {
      const transient = new MongoServerError({
        message: "Write conflict",
        code: 112,
        errorLabels: ["TransientTransactionError"],
      });
      if (kind === "batch") {
        vi.spyOn(Collection.prototype, "bulkWrite").mockRejectedValueOnce(transient);
      } else {
        vi.spyOn(Collection.prototype, "findOneAndUpdate").mockRejectedValueOnce(transient);
      }
      const caughtErrors: unknown[] = [];
      let attempts = 0;
      const client = await getMongoClient();
      await client.withSession(async (session) => {
        await session.withTransaction(async () => {
          attempts += 1;
          await monque.now("transaction-companion", {}, { session, priority: -1 });
          try {
            await (kind === "batch"
              ? monque.enqueueMany([{ name: "work", data: {}, priority: 17 }], { session })
              : monque.schedule(
                  "0 9 * * *",
                  "work",
                  {},
                  { session, priority: 17, uniqueKey: "recurring" },
                ));
          } catch (error) {
            caughtErrors.push(error);
            throw error;
          }
        });
      });
      expect({
        attempts,
        caughtErrorCount: caughtErrors.length,
        originalError: Object.is(caughtErrors[0], transient),
      }).toStrictEqual({
        attempts: 2,
        caughtErrorCount: 1,
        originalError: true,
      });
      await expect(monque.getJobs()).resolves.toMatchObject([{ priority: -1 }, { priority: 17 }]);
    },
  );
});
