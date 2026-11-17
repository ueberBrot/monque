import assert from "node:assert/strict";
import { once } from "node:events";
import { ConnectionError } from "@monque/core";
import type { Monque } from "@monque/core";
import { BSON, MongoBulkWriteError } from "mongodb";
import type { Db, MongoClient } from "mongodb";

const uniqueJob = "compat.unique";
const partialJob = "compat.partial";
const committedJob = "compat.commit";

export const verifyMongoDB = async (
  monque: Monque,
  db: Db,
  client: MongoClient,
  processJobs = true,
): Promise<void> => {
  const collection = db.collection("monque_jobs");

  const payload = {
    id: new BSON.ObjectId(),
    date: new Date("2026-01-01T00:00:00.000Z"),
    amount: BSON.Decimal128.fromString("12.50"),
    binary: new BSON.Binary(Buffer.from([1, 2, 3])),
  };

  const bsonJob = await monque.enqueue("compat.bson", payload);
  const persisted = await monque.getJob(bsonJob._id);
  assert.deepEqual(persisted?.data, payload);

  const duplicates = await Promise.all(
    Array.from(
      { length: 8 },
      async () => await monque.enqueue(uniqueJob, {}, { uniqueKey: "shared" }),
    ),
  );

  assert.equal(new Set(duplicates.map((job) => job._id.toHexString())).size, 1);
  assert.deepEqual(
    await monque.enqueueMany([
      { name: uniqueJob, data: {}, uniqueKey: "shared" },
      { name: uniqueJob, data: {}, uniqueKey: "batch" },
      { name: uniqueJob, data: {}, uniqueKey: "batch" },
      { name: "compat.plain", data: {} },
    ]),
    { insertedCount: 2, deduplicatedCount: 2 },
  );

  await collection.createIndexes([{ key: { "data.email": 1 }, unique: true, sparse: true }]);
  await monque.enqueue("compat.email", { email: "taken@example.test" });
  await assert.rejects(
    monque.enqueueMany([
      { name: partialJob, data: { email: "taken@example.test" }, uniqueKey: "partial" },
      { name: partialJob, data: { email: "free@example.test" }, uniqueKey: "partial" },
    ]),
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Check the native error constructors preserved across the installed driver seam.
    (failure: unknown) =>
      failure instanceof ConnectionError &&
      failure.cause instanceof MongoBulkWriteError &&
      failure.cause.result.getWriteErrors().some((error) => error.code === 11_000),
  );
  assert.equal(await collection.countDocuments({ name: partialJob }), 1);

  await client.withSession(async (session) => {
    await session.withTransaction(async () => {
      await monque.enqueue(committedJob, {}, { session, priority: 8 });
      await monque.enqueueMany([{ name: committedJob, data: {}, priority: -2 }], { session });
      assert.equal(await collection.countDocuments({ name: committedJob }), 0);
      assert.equal(await collection.countDocuments({ name: committedJob }, { session }), 2);
    });
    assert.equal(session.hasEnded, false);
    session.startTransaction();
    await monque.enqueue("compat.abort", {}, { session });
    await session.abortTransaction();
    assert.equal(session.hasEnded, false);
  });
  assert.equal(await collection.countDocuments({ name: committedJob }), 2);
  assert.equal(await collection.countDocuments({ name: "compat.abort" }), 0);

  const page = await monque.getJobsWithCursor({ limit: 2 });
  assert.equal(page.jobs.length, 2);
  assert.ok(page.cursor !== null && page.cursor.length > 0);
  const next = await monque.getJobsWithCursor({ limit: 2, cursor: page.cursor });
  assert.equal(next.jobs.length, 2);
  const ids = new Set(page.jobs.map((job) => job._id.toHexString()));
  assert.ok(next.jobs.every((job) => !ids.has(job._id.toHexString())));

  if (processJobs) {
    let executions = 0;
    monque.register("compat.execute", () => {
      executions += 1;
    });

    const connected = once(monque, "changestream:connected", {
      signal: AbortSignal.timeout(15_000),
    });

    const closed = once(monque, "changestream:closed", { signal: AbortSignal.timeout(15_000) });

    try {
      monque.start();
      await connected;
      const completed = once(monque, "job:complete", { signal: AbortSignal.timeout(15_000) });
      const job = await monque.enqueue("compat.execute", {}, { priority: 9 });
      await completed;
      const executed = await monque.getJob(job._id);
      assert.equal(executed?.status, "completed");
      assert.equal(executions, 1);
    } finally {
      await monque.stop();
      await closed;
    }
  }
};
