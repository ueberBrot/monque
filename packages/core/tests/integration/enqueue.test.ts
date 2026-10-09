/**
 * Tests for the enqueue() method of the Monque scheduler.
 *
 * These tests verify:
 * - Basic job enqueueing functionality
 * - runAt option for delayed jobs
 * - Correct Job document structure returned
 * - Data integrity (payload preserved correctly)
 *
 * @see {@link ../../src/scheduler/monque.ts}
 */
import { Collection, MongoBulkWriteError } from "mongodb";
import type { Db } from "mongodb";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

import { JobStatus } from "@/jobs";
import { Monque } from "@/scheduler";
import { ConnectionError } from "@/shared";
import { TEST_CONSTANTS } from "@test-utils/constants.js";
import {
  cleanupTestDb,
  clearCollection,
  getTestDb,
  stopMonqueInstances,
  uniqueCollectionName,
  waitFor,
} from "@test-utils/test-utils.js";

import { requireValue } from "./helpers";

describe("enqueue()", () => {
  let db: Db;
  let collectionName: string;
  const monqueInstances: Monque[] = [];
  beforeAll(async () => {
    db = await getTestDb("enqueue");
  });

  afterEach(async () => {
    await stopMonqueInstances(monqueInstances);
    if (collectionName) {
      await clearCollection(db, collectionName);
    }
  });

  afterAll(async () => {
    await cleanupTestDb(db);
  });
  describe("enqueueMany()", () => {
    let monque: Monque;
    beforeEach(async () => {
      collectionName = uniqueCollectionName("bulk-enqueue");
      monque = new Monque(db, {
        collectionName,
        maxPayloadSize: 128,
        pollInterval: 60_000,
        safetyPollInterval: 60_000,
      });
      monqueInstances.push(monque);
      await monque.initialize();
    });

    it("preserves active payloads, deduplication, and per-job scheduling in a mixed batch", async () => {
      const existing = await monque.enqueue("work", { original: true }, { uniqueKey: "existing" });
      await db
        .collection(collectionName)
        .updateOne({ _id: existing._id }, { $set: { status: JobStatus.PROCESSING } });
      const completed = await monque.enqueue("work", {}, { uniqueKey: "completed" });
      await db
        .collection(collectionName)
        .updateOne({ _id: completed._id }, { $set: { status: JobStatus.COMPLETED } });
      const runAt = new Date(Date.now() + 60_000);
      await expect(
        monque.enqueueMany([
          { name: "work", data: { replacement: true }, uniqueKey: "existing" },
          { name: "work", data: { first: true }, uniqueKey: "new" },
          { name: "work", data: { first: true }, uniqueKey: "new" },
          { name: "plain", data: {} },
          { name: "plain", data: { delayed: true }, runAt },
          { name: "work", data: {}, uniqueKey: "completed" },
        ]),
      ).resolves.toStrictEqual({ insertedCount: 4, deduplicatedCount: 2 });
      const awaitedResult1 = await monque.getJob(existing._id);
      expect(awaitedResult1?.data).toStrictEqual({ original: true });
      await expect(
        db.collection(collectionName).findOne({ uniqueKey: "new" }),
      ).resolves.toMatchObject({
        data: { first: true },
        status: JobStatus.PENDING,
      });
      await expect(
        db.collection(collectionName).findOne({ "data.delayed": true }),
      ).resolves.toMatchObject({
        nextRunAt: runAt,
      });
      expect({
        completedKeyCount: await db
          .collection(collectionName)
          .countDocuments({ uniqueKey: "completed" }),
        totalCount: await db.collection(collectionName).countDocuments(),
      }).toStrictEqual({ completedKeyCount: 2, totalCount: 6 });
    });

    it.each([
      { name: "", data: {} },
      { name: "work", data: {}, uniqueKey: "" },
      { name: "work", data: { text: "x".repeat(256) } },
    ])("validates the entire batch before writing: %j", async (invalid) => {
      await expect(monque.enqueueMany([{ name: "valid", data: {} }, invalid])).rejects.toThrow(
        Error,
      );
      await expect(db.collection(collectionName).countDocuments()).resolves.toBe(0);
    });

    it("deduplicates concurrent batches against the same active job", async () => {
      const results = await Promise.all(
        Array.from(
          { length: 16 },
          async (_, attempt) =>
            await monque.enqueueMany([
              { name: "work", data: { attempt }, uniqueKey: "shared" },
              { name: "work", data: { attempt }, uniqueKey: "shared" },
            ]),
        ),
      );
      expect({
        insertedCount: results.reduce((sum, result) => sum + result.insertedCount, 0),
        deduplicatedCount: results.reduce((sum, result) => sum + result.deduplicatedCount, 0),
      }).toStrictEqual({
        insertedCount: 1,
        deduplicatedCount: 31,
      });
      await expect(db.collection(collectionName).countDocuments()).resolves.toBe(1);
    });

    it("notifies local workers for immediate and delayed inserts without change streams", async () => {
      const watch = vi.spyOn(Collection.prototype, "watch").mockImplementation(() => {
        throw new Error("Change streams unavailable");
      });
      const received: number[] = [];
      let delayedStartedAt: number | undefined;
      const runAt = new Date(Date.now() + 1000);
      monque.register<{
        id: number;
      }>("work", (job) => {
        if (job.data.id === 2) {
          delayedStartedAt = Date.now();
        }
        received.push(job.data.id);
      });
      try {
        monque.start();
        await monque.enqueueMany([
          { name: "work", data: { id: 1 } },
          { name: "work", data: { id: 2 }, runAt },
        ]);
        await waitFor(() => received.length === 2, { timeout: 5000 });
        expect(delayedStartedAt).toBeGreaterThanOrEqual(runAt.getTime());
        expect(received).toStrictEqual([1, 2]);
      } finally {
        await monque.stop();
        watch.mockRestore();
      }
    });

    it("does not swallow an unrelated unique-index rejection", async () => {
      await db
        .collection(collectionName)
        .createIndex({ "data.email": 1 }, { unique: true, sparse: true });
      await monque.enqueue("existing", { email: "same@example.test" });
      await expect(
        monque.enqueueMany([
          { name: "work", data: { email: "same@example.test" }, uniqueKey: "new" },
        ]),
      ).rejects.toThrow(ConnectionError);
      await expect(db.collection(collectionName).countDocuments({ name: "work" })).resolves.toBe(0);
    });

    it("preserves successful writes and native error details when another job is rejected", async () => {
      await db.command({ collMod: collectionName, validator: { "data.reject": { $ne: true } } });
      let failure: unknown;
      try {
        await monque.enqueueMany([
          { name: "work", data: { id: 1 } },
          { name: "work", data: { id: 2, reject: true } },
          { name: "work", data: { id: 3 } },
        ]);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(ConnectionError);
      if (
        !(failure instanceof ConnectionError) ||
        !(failure.cause instanceof MongoBulkWriteError)
      ) {
        throw new Error("Expected a ConnectionError caused by MongoBulkWriteError");
      }
      expect(failure.cause.result.upsertedCount).toBe(2);
      expect(failure.cause.writeErrors).toMatchObject([{ index: 1, code: 121 }]);
      await expect(
        db.collection(collectionName).find().sort({ "data.id": 1 }).toArray(),
      ).resolves.toMatchObject([{ data: { id: 1 } }, { data: { id: 3 } }]);
    });
  });
  describe("basic enqueueing", () => {
    it("persists the payload and default fields of a new pending job", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const data = {
        message: "Hello",
        count: 42,
        price: 19.99,
        active: true,
        deleted: false,
        optional: null,
        items: [1, 2, 3],
        user: { profile: { name: "John" }, options: ["a", "b"] },
      };
      const beforeEnqueue = Date.now();
      const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, data);
      const afterEnqueue = Date.now();
      expect(job._id).toBeDefined();
      expect({
        jobName: job.name,
        jobData: job.data,
        jobStatus: job.status,
        jobFailCount: job.failCount,
      }).toStrictEqual({
        jobName: TEST_CONSTANTS.JOB_NAME,
        jobData: data,
        jobStatus: JobStatus.PENDING,
        jobFailCount: 0,
      });
      for (const timestamp of [job.createdAt, job.updatedAt, job.nextRunAt]) {
        expect(timestamp.getTime()).toBeGreaterThanOrEqual(beforeEnqueue);
        expect(timestamp.getTime()).toBeLessThanOrEqual(afterEnqueue);
      }
      expect({
        jobUniqueKey: job.uniqueKey,
        jobRepeatInterval: job.repeatInterval,
        jobFailReason: job.failReason,
        jobClaimedBy: job.claimedBy,
        jobLastHeartbeat: job.lastHeartbeat,
        jobHeartbeatInterval: job.heartbeatInterval,
      }).toStrictEqual({
        jobUniqueKey: undefined,
        jobRepeatInterval: undefined,
        jobFailReason: undefined,
        jobClaimedBy: undefined,
        jobLastHeartbeat: undefined,
        jobHeartbeatInterval: undefined,
      });
      await expect(db.collection(collectionName).findOne({ _id: job._id })).resolves.toStrictEqual(
        job,
      );
    });
  });
  describe("runAt option", () => {
    it("should schedule job for future execution with runAt", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      // 1 minute in future
      const futureDate = new Date(Date.now() + 60_000);
      const job = await monque.enqueue(
        TEST_CONSTANTS.JOB_NAME,
        { task: "later" },
        { runAt: futureDate },
      );
      expect(job.nextRunAt.getTime()).toBe(futureDate.getTime());
    });

    it("should accept runAt in the past", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      // 1 minute in past
      const pastDate = new Date(Date.now() - 60_000);
      const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, {}, { runAt: pastDate });
      expect(job.nextRunAt.getTime()).toBe(pastDate.getTime());
    });
  });
  describe("return value", () => {
    it("should include uniqueKey when provided", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, {}, { uniqueKey: "test-key-123" });
      expect(job.uniqueKey).toBe("test-key-123");
    });
  });
  describe("error handling", () => {
    it("should throw if not initialized", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      // Do NOT call initialize()
      await expect(monque.enqueue("test", {})).rejects.toThrow("not initialized");
    });
  });
});
describe("now()", () => {
  let db: Db;
  let collectionName: string;
  const monqueInstances: Monque[] = [];
  beforeAll(async () => {
    db = await getTestDb("now");
  });

  afterEach(async () => {
    await stopMonqueInstances(monqueInstances);
    if (collectionName) {
      await clearCollection(db, collectionName);
    }
  });

  afterAll(async () => {
    await cleanupTestDb(db);
  });

  it("should enqueue a job for immediate processing", async () => {
    collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
    const monque = new Monque(db, { collectionName });
    monqueInstances.push(monque);
    await monque.initialize();
    const beforeNow = new Date();
    const job = await monque.now(TEST_CONSTANTS.JOB_NAME, { urgent: true });
    const afterNow = new Date();
    expect(job).toMatchObject({
      name: TEST_CONSTANTS.JOB_NAME,
      data: { urgent: true },
      status: JobStatus.PENDING,
      failCount: 0,
    });
    expect(job.nextRunAt.getTime()).toBeGreaterThanOrEqual(beforeNow.getTime());
    expect(job.nextRunAt.getTime()).toBeLessThanOrEqual(afterNow.getTime());
    await expect(db.collection(collectionName).findOne({ _id: job._id })).resolves.toStrictEqual(
      job,
    );
  });
});
/**
 * Tests for uniqueKey deduplication behavior.
 *
 * These tests verify prevent Duplicate Jobs with Unique Keys:
 * - pending jobs block new jobs with same uniqueKey
 * - processing jobs block new jobs with same uniqueKey
 * - completed jobs allow new jobs with same uniqueKey
 * - failed jobs allow new jobs with same uniqueKey
 *
 * @see {@link ../../src/scheduler/monque.ts}
 */
describe("uniqueKey deduplication", () => {
  let db: Db;
  let collectionName: string;
  const monqueInstances: Monque[] = [];
  beforeAll(async () => {
    db = await getTestDb("uniqueKey");
  });

  afterEach(async () => {
    await stopMonqueInstances(monqueInstances);
    if (collectionName) {
      await clearCollection(db, collectionName);
    }
  });

  afterAll(async () => {
    await cleanupTestDb(db);
  });
  describe("pending job blocks new job with same uniqueKey", () => {
    it("should return the original job document when deduped", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      // Create first job with uniqueKey
      const job1 = await monque.enqueue(
        TEST_CONSTANTS.JOB_NAME,
        { userId: "123", first: true },
        { uniqueKey: "sync-user-123" },
      );
      // Try to create duplicate with different data
      const job2 = await monque.enqueue(
        TEST_CONSTANTS.JOB_NAME,
        { userId: "123", second: true },
        { uniqueKey: "sync-user-123" },
      );
      // Should return existing job with original data
      expect(job2).toStrictEqual(job1);
      await expect(
        db.collection(collectionName).countDocuments({ uniqueKey: "sync-user-123" }),
      ).resolves.toBe(1);
    });
  });
  describe("processing job blocks new job with same uniqueKey", () => {
    it("should not create duplicate when processing job exists with same uniqueKey", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      // Create a job with uniqueKey
      const job1 = await monque.enqueue(
        TEST_CONSTANTS.JOB_NAME,
        { userId: "123" },
        { uniqueKey: "sync-user-123" },
      );
      expect(job1._id).toBeDefined();
      // Manually update job status to processing (simulating worker pickup)
      const collection = db.collection(collectionName);
      await collection.updateOne(
        { _id: job1._id },
        { $set: { status: JobStatus.PROCESSING, lockedAt: new Date() } },
      );
      // Try to create another job with same uniqueKey
      const job2 = await monque.enqueue(
        TEST_CONSTANTS.JOB_NAME,
        { userId: "123" },
        { uniqueKey: "sync-user-123" },
      );
      // Should return the existing job (same _id)
      expect(job2._id?.toString()).toBe(job1._id?.toString());
      // Should only be one job in the collection
      const count = await collection.countDocuments({ uniqueKey: "sync-user-123" });
      expect(count).toBe(1);
    });
  });
  describe("completed job allows new job with same uniqueKey", () => {
    it("should create new job when completed job exists with same uniqueKey", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      // Create a job with uniqueKey
      const job1 = await monque.enqueue(
        TEST_CONSTANTS.JOB_NAME,
        { userId: "123" },
        { uniqueKey: "sync-user-123" },
      );
      expect(job1._id).toBeDefined();
      // Manually update job status to completed
      const collection = db.collection(collectionName);
      await collection.updateOne({ _id: job1._id }, { $set: { status: JobStatus.COMPLETED } });
      // Create another job with same uniqueKey
      const job2 = await monque.enqueue(
        TEST_CONSTANTS.JOB_NAME,
        { userId: "123", retry: true },
        { uniqueKey: "sync-user-123" },
      );
      // Should create a NEW job (different _id)
      expect(job2._id?.toString()).not.toBe(job1._id?.toString());
      expect({
        job2Status: job2.status,
        job2Data: job2.data,
      }).toStrictEqual({
        job2Status: JobStatus.PENDING,
        job2Data: { userId: "123", retry: true },
      });
      // Should have two jobs in the collection (one completed, one pending)
      const totalCount = await collection.countDocuments({ uniqueKey: "sync-user-123" });
      expect(totalCount).toBe(2);
      const pendingCount = await collection.countDocuments({
        uniqueKey: "sync-user-123",
        status: JobStatus.PENDING,
      });
      expect(pendingCount).toBe(1);
    });
  });
  describe("failed job allows new job with same uniqueKey", () => {
    it("should create new job when failed job exists with same uniqueKey", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      // Create a job with uniqueKey
      const job1 = await monque.enqueue(
        TEST_CONSTANTS.JOB_NAME,
        { userId: "123" },
        { uniqueKey: "sync-user-123" },
      );
      expect(job1._id).toBeDefined();
      // Manually update job status to failed (permanent failure after max retries)
      const collection = db.collection(collectionName);
      await collection.updateOne(
        { _id: job1._id },
        {
          $set: {
            status: JobStatus.FAILED,
            failCount: 10,
            failReason: "Max retries exceeded",
          },
        },
      );
      // Create another job with same uniqueKey
      const job2 = await monque.enqueue(
        TEST_CONSTANTS.JOB_NAME,
        { userId: "123", retry: true },
        { uniqueKey: "sync-user-123" },
      );
      // Should create a NEW job (different _id)
      expect(job2._id?.toString()).not.toBe(job1._id?.toString());
      expect(job2.status).toBe(JobStatus.PENDING);
      // Should have two jobs in the collection (one failed, one pending)
      const totalCount = await collection.countDocuments({ uniqueKey: "sync-user-123" });
      expect(totalCount).toBe(2);
    });
  });
  describe("concurrent enqueue with same uniqueKey", () => {
    it("should handle concurrent enqueue attempts atomically", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      // Create 10 concurrent enqueue attempts with same uniqueKey
      const enqueuePromises = Array.from(
        { length: 10 },
        async (_, i) =>
          await monque.enqueue(
            TEST_CONSTANTS.JOB_NAME,
            { attempt: i },
            { uniqueKey: "concurrent-test" },
          ),
      );
      const results = await Promise.all(enqueuePromises);
      // All results should be defined
      expect(results).toHaveLength(10);
      // Get first result and verify it exists
      const firstResult = requireValue(results[0]);
      expect(firstResult._id).toBeDefined();
      // All should return the same job (same _id)
      const firstId = firstResult._id.toString();
      expect(results.every((job) => job._id?.toString() === firstId)).toBe(true);
      // Should only be one job in the collection
      const collection = db.collection(collectionName);
      const count = await collection.countDocuments({ uniqueKey: "concurrent-test" });
      expect(count).toBe(1);
    });
  });
  describe("different uniqueKeys create separate jobs", () => {
    it("should create separate jobs for different uniqueKeys", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const job1 = await monque.enqueue(
        TEST_CONSTANTS.JOB_NAME,
        { userId: "111" },
        { uniqueKey: "sync-user-111" },
      );
      const job2 = await monque.enqueue(
        TEST_CONSTANTS.JOB_NAME,
        { userId: "222" },
        { uniqueKey: "sync-user-222" },
      );
      const job3 = await monque.enqueue(
        TEST_CONSTANTS.JOB_NAME,
        { userId: "333" },
        { uniqueKey: "sync-user-333" },
      );
      // All should have different _ids
      expect(job1._id?.toString()).not.toBe(job2._id?.toString());
      expect(job2._id?.toString()).not.toBe(job3._id?.toString());
      // Should have three jobs in the collection
      const collection = db.collection(collectionName);
      const count = await collection.countDocuments({});
      expect(count).toBe(3);
    });
  });
  describe("jobs without uniqueKey are not deduplicated", () => {
    it("should create multiple jobs when no uniqueKey is provided", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      // Create multiple jobs without uniqueKey
      const job1 = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { to: "user@example.com" });
      const job2 = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { to: "user@example.com" });
      const job3 = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { to: "user@example.com" });
      // All should have different _ids
      expect(job1._id?.toString()).not.toBe(job2._id?.toString());
      expect(job2._id?.toString()).not.toBe(job3._id?.toString());
      // Should have three jobs in the collection
      const collection = db.collection(collectionName);
      const count = await collection.countDocuments({});
      expect(count).toBe(3);
    });
  });
});
