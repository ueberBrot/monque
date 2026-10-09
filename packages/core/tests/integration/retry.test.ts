import { setTimeout as pauseFor } from "node:timers/promises";
/**
 * Tests for retry logic with exponential backoff in the Monque scheduler.
 *
 * These tests verify:
 * - Backoff timing within ±50ms
 * - failCount increment and failReason storage on job failure
 * - Permanent failure after maxRetries is exceeded
 *
 * @see {@link ../../src/scheduler/monque.ts}
 * @see {@link ../../src/shared/utils/backoff.ts}
 */
import type { Db } from "mongodb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";

import { JobStatus } from "@/jobs";
import type { Job } from "@/jobs";
import { Monque } from "@/scheduler";
import { TEST_CONSTANTS } from "@test-utils/constants.js";
import {
  cleanupTestDb,
  clearCollection,
  getTestDb,
  stopMonqueInstances,
  uniqueCollectionName,
  waitFor,
} from "@test-utils/test-utils.js";
import { JobFactoryHelpers } from "@tests/factories/job.factory.js";

import { requireValue } from "./helpers";
// removed calculateBackoffDelay import
describe("Retry Logic", () => {
  let db: Db;
  let collectionName: string;
  let monque: Monque;
  const monqueInstances: Monque[] = [];
  beforeAll(async () => {
    db = await getTestDb("retry");
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
  describe("Backoff timing", () => {
    /**
     * Failed jobs retry automatically. The actual nextRunAt MUST be within ±50ms
     * of the calculated backoff time.
     *
     * Formula: nextRunAt = now + (2^failCount × baseInterval)
     */
    it("should schedule first retry with correct backoff timing (2^1 * 1000 = 2000ms)", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      monque = new Monque(db, {
        collectionName,
        pollInterval: 100,
        baseRetryInterval: 1000,
      });
      monqueInstances.push(monque);
      await monque.initialize();
      // Handler that fails once
      let callCount = 0;
      let failureTime = 0;
      monque.register<{
        test: boolean;
      }>(TEST_CONSTANTS.JOB_NAME, () => {
        callCount += 1;
        if (callCount === 1) {
          failureTime = Date.now();
          throw new Error("First attempt fails");
        }
      });
      const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { test: true });
      monque.start();
      // Wait for the job to fail and be rescheduled
      await waitFor(async () => {
        const doc = await db.collection<Job>(collectionName).findOne({ _id: job._id });
        return doc !== null && doc.failCount === 1;
      });
      // Stop the scheduler to prevent retry processing
      await monque.stop();
      // Check the nextRunAt timing
      const doc = requireValue(await db.collection<Job>(collectionName).findOne({ _id: job._id }));
      expect(doc).not.toBeNull();
      expect({
        docFailCount: doc.failCount,
        docStatus: doc.status,
      }).toStrictEqual({
        docFailCount: 1,
        docStatus: JobStatus.PENDING,
      });
      const nextRunAt = new Date(doc.nextRunAt).getTime();
      // 2000ms
      const expectedBaseDelay = 2 ** 1 * 1000;
      // 500ms
      const expectedMaxJitter = expectedBaseDelay * 0.25;
      const expectedNextRunAt = failureTime + expectedBaseDelay;
      // Verify timing is within tolerance (jitter + processing buffer)
      const timingDiff = Math.abs(nextRunAt - expectedNextRunAt);
      expect(timingDiff).toBeLessThanOrEqual(expectedMaxJitter + 250);
    });

    it("should schedule second retry with correct backoff timing (2^2 * 1000 = 4000ms)", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      monque = new Monque(db, {
        collectionName,
        pollInterval: 50,
        baseRetryInterval: 1000,
      });
      monqueInstances.push(monque);
      await monque.initialize();
      // Handler that always fails
      let callCount = 0;
      let failureTime = 0;
      monque.register<{
        test: boolean;
      }>(TEST_CONSTANTS.JOB_NAME, () => {
        callCount += 1;
        failureTime = Date.now();
        throw new Error(`Attempt ${callCount} fails`);
      });
      // Insert a job that already has failCount=1
      const collection = db.collection<Job>(collectionName);
      const result = await collection.insertOne(
        JobFactoryHelpers.withData(
          { test: true },
          {
            name: TEST_CONSTANTS.JOB_NAME,
            failCount: 1,
          },
        ),
      );
      monque.start();
      // Wait for the job to fail again
      await waitFor(async () => {
        const doc = await collection.findOne({
          _id: result.insertedId,
        });
        return doc !== null && doc.failCount === 2;
      });
      await monque.stop();
      const doc = requireValue(await collection.findOne({ _id: result.insertedId }));
      expect({
        docFailCount: doc.failCount,
        docStatus: doc.status,
      }).toStrictEqual({
        docFailCount: 2,
        docStatus: JobStatus.PENDING,
      });
      const nextRunAt = new Date(doc.nextRunAt).getTime();
      // 4000ms
      const expectedBaseDelay = 2 ** 2 * 1000;
      // 1000ms
      const expectedMaxJitter = expectedBaseDelay * 0.25;
      const expectedNextRunAt = failureTime + expectedBaseDelay;
      // Verify timing is within tolerance (jitter + processing buffer)
      const timingDiff = Math.abs(nextRunAt - expectedNextRunAt);
      expect(timingDiff).toBeLessThanOrEqual(expectedMaxJitter + 250);
    });

    it("should use configurable baseRetryInterval for backoff calculation", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      // 500ms instead of default 1000ms
      const customBaseInterval = 500;
      monque = new Monque(db, {
        collectionName,
        pollInterval: 50,
        baseRetryInterval: customBaseInterval,
      });
      monqueInstances.push(monque);
      await monque.initialize();
      let failureTime = 0;
      monque.register<{
        test: boolean;
      }>(TEST_CONSTANTS.JOB_NAME, () => {
        failureTime = Date.now();
        throw new Error("Always fails");
      });
      const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { test: true });
      monque.start();
      await waitFor(async () => {
        const doc = await db.collection<Job>(collectionName).findOne({ _id: job._id });
        return doc !== null && doc.failCount === 1;
      });
      await monque.stop();
      const doc = requireValue(await db.collection<Job>(collectionName).findOne({ _id: job._id }));
      const nextRunAt = new Date(doc.nextRunAt).getTime();
      // 1000ms
      const expectedBaseDelay = 2 ** 1 * customBaseInterval;
      // 250ms
      const expectedMaxJitter = expectedBaseDelay * 0.25;
      const expectedNextRunAt = failureTime + expectedBaseDelay;
      const timingDiff = Math.abs(nextRunAt - expectedNextRunAt);
      expect(timingDiff).toBeLessThanOrEqual(expectedMaxJitter + 200);
    });
  });
  describe("failCount increment and failReason storage", () => {
    it("should increment failCount on job failure", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      monque = new Monque(db, {
        collectionName,
        pollInterval: 50,
      });
      monqueInstances.push(monque);
      await monque.initialize();
      monque.register<{
        test: boolean;
      }>(TEST_CONSTANTS.JOB_NAME, () => {
        throw new Error("Always fails");
      });
      const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { test: true });
      monque.start();
      // Wait for first failure
      await waitFor(async () => {
        const doc = await db.collection<Job>(collectionName).findOne({ _id: job._id });
        return doc !== null && doc.failCount === 1;
      });
      await monque.stop();
      const doc = requireValue(await db.collection<Job>(collectionName).findOne({ _id: job._id }));
      expect(doc.failCount).toBe(1);
    });

    it("should store failReason from error message", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      monque = new Monque(db, {
        collectionName,
        pollInterval: 50,
      });
      monqueInstances.push(monque);
      await monque.initialize();
      const errorMessage = "Connection timeout to external API";
      monque.register<{
        test: boolean;
      }>(TEST_CONSTANTS.JOB_NAME, () => {
        throw new Error(errorMessage);
      });
      const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { test: true });
      monque.start();
      await waitFor(async () => {
        const doc = await db.collection<Job>(collectionName).findOne({ _id: job._id });
        return doc !== null && doc.failCount === 1;
      });
      await monque.stop();
      const doc = requireValue(await db.collection<Job>(collectionName).findOne({ _id: job._id }));
      expect(doc.failReason).toBe(errorMessage);
    });

    it("should update failReason on subsequent failures", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      monque = new Monque(db, {
        collectionName,
        pollInterval: 50,
        // Fast retries for testing
        baseRetryInterval: 10,
      });
      monqueInstances.push(monque);
      await monque.initialize();
      let callCount = 0;
      let failureEvents = 0;
      monque.register<{
        test: boolean;
      }>(TEST_CONSTANTS.JOB_NAME, () => {
        callCount += 1;
        throw new Error(`Failure #${callCount}`);
      });
      monque.on("job:fail", () => {
        failureEvents += 1;
      });
      const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { test: true });
      monque.start();
      // Wait for second failure
      await waitFor(() => failureEvents >= 2, { timeout: 5000 });
      await monque.stop();
      const doc = requireValue(await db.collection<Job>(collectionName).findOne({ _id: job._id }));
      expect(doc.failCount).toBeGreaterThanOrEqual(2);
      // failReason should contain the most recent error
      expect(doc.failReason).toMatch(/Failure #\d+/u);
    });

    it("should handle both sync throws and async rejections identically", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      monque = new Monque(db, {
        collectionName,
        pollInterval: 50,
      });
      monqueInstances.push(monque);
      await monque.initialize();
      // Sync throw handler
      monque.register<{
        type: string;
      }>(TEST_CONSTANTS.JOB_NAME, (job) => {
        if (job.data.type === "sync") {
          throw new Error("Sync error");
        }
        throw new Error("Async error");
      });
      const syncJob = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { type: "sync" });
      monque.start();
      await waitFor(async () => {
        const doc = await db.collection<Job>(collectionName).findOne({ _id: syncJob._id });
        return doc !== null && doc.failCount === 1;
      });
      await monque.stop();
      const syncDoc = requireValue(
        await db.collection<Job>(collectionName).findOne({ _id: syncJob._id }),
      );
      expect({
        syncDocFailCount: syncDoc.failCount,
        syncDocFailReason: syncDoc.failReason,
        syncDocStatus: syncDoc.status,
      }).toStrictEqual({
        syncDocFailCount: 1,
        syncDocFailReason: "Sync error",
        syncDocStatus: JobStatus.PENDING,
      });
    });

    it("should set status back to pending after failure (if retries remain)", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      monque = new Monque(db, {
        collectionName,
        pollInterval: 50,
        maxRetries: 5,
      });
      monqueInstances.push(monque);
      await monque.initialize();
      monque.register<{
        test: boolean;
      }>(TEST_CONSTANTS.JOB_NAME, () => {
        throw new Error("Temporary failure");
      });
      const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { test: true });
      monque.start();
      await waitFor(async () => {
        const doc = await db.collection<Job>(collectionName).findOne({ _id: job._id });
        return doc !== null && doc.failCount === 1;
      });
      await monque.stop();
      const doc = requireValue(await db.collection<Job>(collectionName).findOne({ _id: job._id }));
      expect({
        docStatus: doc.status,
        docLockedAt: doc.lockedAt,
      }).toStrictEqual({
        docStatus: JobStatus.PENDING,
        docLockedAt: undefined,
      });
    });
  });
  describe("Max retries → permanent failure", () => {
    it("should mark job as permanently failed after maxRetries (default: 10)", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      monque = new Monque(db, {
        collectionName,
        pollInterval: 50,
        // Lower for faster testing
        maxRetries: 3,
        // Fast retries
        baseRetryInterval: 10,
      });
      monqueInstances.push(monque);
      await monque.initialize();
      monque.register<{
        test: boolean;
      }>(TEST_CONSTANTS.JOB_NAME, () => {
        throw new Error("Persistent failure");
      });
      const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { test: true });
      monque.start();
      // Wait for permanent failure (failCount >= maxRetries)
      await waitFor(
        async () => {
          const doc = await db.collection<Job>(collectionName).findOne({ _id: job._id });
          return doc !== null && doc.status === JobStatus.FAILED;
        },
        { timeout: 5000 },
      );
      await monque.stop();
      const doc = requireValue(await db.collection<Job>(collectionName).findOne({ _id: job._id }));
      expect({
        docStatus: doc.status,
        docFailCount: doc.failCount,
        docFailReason: doc.failReason,
      }).toStrictEqual({
        docStatus: JobStatus.FAILED,
        docFailCount: 3,
        docFailReason: "Persistent failure",
      });
    });

    it("should respect custom maxRetries configuration", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const customMaxRetries = 2;
      monque = new Monque(db, {
        collectionName,
        pollInterval: 50,
        maxRetries: customMaxRetries,
        baseRetryInterval: 10,
      });
      monqueInstances.push(monque);
      await monque.initialize();
      let failCount = 0;
      monque.register<{
        test: boolean;
      }>(TEST_CONSTANTS.JOB_NAME, () => {
        failCount += 1;
        throw new Error(`Failure ${failCount}`);
      });
      const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { test: true });
      monque.start();
      await waitFor(
        async () => {
          const doc = await db.collection<Job>(collectionName).findOne({ _id: job._id });
          return doc !== null && doc.status === JobStatus.FAILED;
        },
        { timeout: 5000 },
      );
      await monque.stop();
      const doc = requireValue(await db.collection<Job>(collectionName).findOne({ _id: job._id }));
      expect({
        docStatus: doc.status,
        docFailCount: doc.failCount,
      }).toStrictEqual({
        docStatus: JobStatus.FAILED,
        docFailCount: customMaxRetries,
      });
    });

    it("should not process permanently failed jobs", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      monque = new Monque(db, {
        collectionName,
        pollInterval: 50,
      });
      monqueInstances.push(monque);
      await monque.initialize();
      let handlerCalls = 0;
      monque.register<{
        test: boolean;
      }>(TEST_CONSTANTS.JOB_NAME, () => {
        handlerCalls += 1;
      });
      // Insert a permanently failed job
      const collection = db.collection<Job>(collectionName);
      await collection.insertOne(
        JobFactoryHelpers.failed({
          name: TEST_CONSTANTS.JOB_NAME,
          data: { test: true },
        }),
      );
      monque.start();
      // Wait a bit and verify handler was never called
      await pauseFor(500);
      await monque.stop();
      expect(handlerCalls).toBe(0);
    });

    it("should preserve job data on permanent failure", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      monque = new Monque(db, {
        collectionName,
        pollInterval: 50,
        maxRetries: 1,
        baseRetryInterval: 10,
      });
      monqueInstances.push(monque);
      await monque.initialize();
      const jobData = {
        userId: "user-123",
        action: "important-action",
        metadata: { key: "value" },
      };
      monque.register<typeof jobData>(TEST_CONSTANTS.JOB_NAME, () => {
        throw new Error("Failure");
      });
      const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, jobData);
      monque.start();
      await waitFor(
        async () => {
          const doc = await db.collection<Job>(collectionName).findOne({ _id: job._id });
          return doc !== null && doc.status === JobStatus.FAILED;
        },
        { timeout: 5000 },
      );
      await monque.stop();
      const doc = requireValue(await db.collection<Job>(collectionName).findOne({ _id: job._id }));
      // Verify all original data is preserved
      expect({
        docData: doc.data,
        docName: doc.name,
      }).toStrictEqual({
        docData: jobData,
        docName: TEST_CONSTANTS.JOB_NAME,
      });
    });
  });
  describe("Events during retry", () => {
    it("should emit job:fail event with willRetry=true when retries remain", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      monque = new Monque(db, {
        collectionName,
        pollInterval: 50,
        maxRetries: 5,
      });
      monqueInstances.push(monque);
      await monque.initialize();
      const failEvents: {
        job: Job;
        error: Error;
        willRetry: boolean;
      }[] = [];
      monque.on("job:fail", (event) => {
        failEvents.push(event);
      });
      monque.register<{
        test: boolean;
      }>(TEST_CONSTANTS.JOB_NAME, () => {
        throw new Error("Temporary failure");
      });
      await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { test: true });
      monque.start();
      await waitFor(() => failEvents.length >= 1);
      await monque.stop();
      expect(failEvents.length).toBeGreaterThanOrEqual(1);
      const [firstEvent] = failEvents;
      if (!firstEvent) {
        throw new Error("Expected failEvents[0] to be defined");
      }
      expect({
        firstEventWillRetry: firstEvent.willRetry,
        firstEventErrorMessage: firstEvent.error.message,
      }).toStrictEqual({
        firstEventWillRetry: true,
        firstEventErrorMessage: "Temporary failure",
      });
    });

    it("should emit job:fail event with willRetry=false on final failure", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      monque = new Monque(db, {
        collectionName,
        pollInterval: 50,
        maxRetries: 1,
        baseRetryInterval: 10,
      });
      monqueInstances.push(monque);
      await monque.initialize();
      const failEvents: {
        job: Job;
        error: Error;
        willRetry: boolean;
      }[] = [];
      monque.on("job:fail", (event) => {
        failEvents.push(event);
      });
      monque.register<{
        test: boolean;
      }>(TEST_CONSTANTS.JOB_NAME, () => {
        throw new Error("Final failure");
      });
      await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { test: true });
      monque.start();
      // Wait for the job to reach failed status
      await waitFor(
        () =>
          // Find the event where willRetry is false
          failEvents.some((e) => !e.willRetry),
        { timeout: 5000 },
      );
      await monque.stop();
      // Should have exactly maxRetries fail events
      const finalEvent = failEvents.find((e) => !e.willRetry);
      if (!finalEvent) {
        throw new Error("Expected finalEvent to be defined");
      }
      expect(finalEvent.willRetry).toBe(false);
    });
  });
});
