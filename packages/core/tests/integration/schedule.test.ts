/**
 * Tests for the schedule() method of the Monque scheduler.
 *
 * These tests verify:
 * - Basic cron job scheduling functionality
 * - nextRunAt calculation from cron expressions
 * - repeatInterval storage
 * - Invalid cron expression handling with helpful messages
 * - Recurring job completion and auto-rescheduling
 * - Cron timing after retries
 *
 * @see {@link ../../src/scheduler/monque.ts}
 */
import type { Db } from "mongodb";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { JobStatus } from "@/jobs";
import type { Job } from "@/jobs";
import { Monque } from "@/scheduler";
import { InvalidCronError } from "@/shared";
import { TEST_CONSTANTS } from "@test-utils/constants.js";
import {
  cleanupTestDb,
  clearCollection,
  getTestDb,
  stopMonqueInstances,
  triggerJobImmediately,
  uniqueCollectionName,
  waitFor,
} from "@test-utils/test-utils.js";

import { requireValue } from "./helpers";

describe("schedule()", () => {
  let db: Db;
  let collectionName: string;
  const monqueInstances: Monque[] = [];
  beforeAll(async () => {
    db = await getTestDb("schedule");
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
  // Tests for schedule() method (cron parsing, nextRunAt calculation)
  describe("basic cron scheduling", () => {
    it("persists a pending recurring job with defaults and the next cron occurrence", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const beforeSchedule = Date.now();
      const job = await monque.schedule(
        "0 * * * *",
        TEST_CONSTANTS.JOB_NAME,
        TEST_CONSTANTS.JOB_DATA,
      );
      const afterSchedule = Date.now();
      expect(job._id).toBeDefined();
      expect({
        jobName: job.name,
        jobData: job.data,
        jobStatus: job.status,
        jobFailCount: job.failCount,
        jobRepeatInterval: job.repeatInterval,
      }).toStrictEqual({
        jobName: TEST_CONSTANTS.JOB_NAME,
        jobData: TEST_CONSTANTS.JOB_DATA,
        jobStatus: JobStatus.PENDING,
        jobFailCount: 0,
        jobRepeatInterval: "0 * * * *",
      });
      expect({
        createdWithinCall:
          job.createdAt.getTime() >= beforeSchedule && job.createdAt.getTime() <= afterSchedule,
        updatedWithinCall:
          job.updatedAt.getTime() >= beforeSchedule && job.updatedAt.getTime() <= afterSchedule,
        nextRunWithinNextHour:
          job.nextRunAt.getTime() > beforeSchedule &&
          job.nextRunAt.getTime() <= afterSchedule + 3_600_000,
      }).toStrictEqual({
        createdWithinCall: true,
        updatedWithinCall: true,
        nextRunWithinNextHour: true,
      });
      expect({
        jobNextRunAtGetMinutes: job.nextRunAt.getMinutes(),
        jobNextRunAtGetSeconds: job.nextRunAt.getSeconds(),
      }).toStrictEqual({
        jobNextRunAtGetMinutes: 0,
        jobNextRunAtGetSeconds: 0,
      });
      await expect(
        db.collection<Job>(collectionName).findOne({ _id: job._id }),
      ).resolves.toStrictEqual(job);
    });
  });
  // Tests for invalid cron expression (throws InvalidCronError with helpful message)
  describe("invalid cron expressions", () => {
    it("should throw InvalidCronError for invalid expression", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      await expect(monque.schedule("invalid", TEST_CONSTANTS.JOB_NAME, {})).rejects.toThrow(
        InvalidCronError,
      );
    }, 10_000);
  });
  // Tests for uniqueKey deduplication in schedule()
  describe("uniqueKey deduplication", () => {
    it("should create a new job when uniqueKey is not provided", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const job1 = await monque.schedule(
        TEST_CONSTANTS.CRON_EVERY_MINUTE,
        TEST_CONSTANTS.JOB_NAME,
        { v: 1 },
      );
      const job2 = await monque.schedule(
        TEST_CONSTANTS.CRON_EVERY_MINUTE,
        TEST_CONSTANTS.JOB_NAME,
        { v: 2 },
      );
      expect(job1._id).not.toStrictEqual(job2._id);
    });

    it("should return existing job when duplicate uniqueKey already exists for same name", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const uniqueKey = "duplicate-schedule-key";
      const job1 = await monque.schedule(
        TEST_CONSTANTS.CRON_EVERY_MINUTE,
        TEST_CONSTANTS.JOB_NAME,
        { value: 1 },
        { uniqueKey },
      );
      const job2 = await monque.schedule(
        TEST_CONSTANTS.CRON_EVERY_MINUTE,
        TEST_CONSTANTS.JOB_NAME,
        { value: 2 },
        { uniqueKey },
      );
      // Should return the existing job (same _id)
      expect(job2._id.toString()).toBe(job1._id.toString());
      // Should only be one job in the collection
      const collection = db.collection<Job>(collectionName);
      const count = await collection.countDocuments({ uniqueKey });
      expect(count).toBe(1);
    });

    it("should allow same uniqueKey for different job names", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const uniqueKey = "shared-unique-key";
      const job1 = await monque.schedule(
        TEST_CONSTANTS.CRON_EVERY_MINUTE,
        "job-name-1",
        { value: 1 },
        { uniqueKey },
      );
      const job2 = await monque.schedule(
        TEST_CONSTANTS.CRON_EVERY_MINUTE,
        "job-name-2",
        { value: 2 },
        { uniqueKey },
      );
      // Different job names should create different jobs even with same uniqueKey
      expect(job1._id.toString()).not.toStrictEqual(job2._id.toString());
    });

    it("should not update existing job data when duplicate uniqueKey is scheduled", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const uniqueKey = "no-update-key";
      const originalData = { original: true };
      const newData = { original: false, extra: "field" };
      await monque.schedule(
        TEST_CONSTANTS.CRON_EVERY_MINUTE,
        TEST_CONSTANTS.JOB_NAME,
        originalData,
        { uniqueKey },
      );
      const job2 = await monque.schedule(
        TEST_CONSTANTS.CRON_EVERY_MINUTE,
        TEST_CONSTANTS.JOB_NAME,
        newData,
        { uniqueKey },
      );
      // Returned job should have original data
      expect(job2.data).toStrictEqual(originalData);
      // Verify the original data is preserved in DB
      const collection = db.collection<Job>(collectionName);
      const job = await collection.findOne({ name: TEST_CONSTANTS.JOB_NAME, uniqueKey });
      expect(job?.data).toStrictEqual(originalData);
    });

    it("should preserve uniqueKey in the persisted job", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const uniqueKey = "preserved-key";
      const job = await monque.schedule(
        TEST_CONSTANTS.CRON_EVERY_MINUTE,
        TEST_CONSTANTS.JOB_NAME,
        {},
        { uniqueKey },
      );
      expect(job._id).toBeDefined();
      expect(job.uniqueKey).toBe(uniqueKey);
      const collection = db.collection<Job>(collectionName);
      const persistedJob = await collection.findOne({ name: TEST_CONSTANTS.JOB_NAME, uniqueKey });
      expect(persistedJob?.uniqueKey).toBe(uniqueKey);
    });
  });
  // Tests for recurring job completion (auto-reschedule after success, uses original cron timing after retries)
  describe("recurring job completion and rescheduling", () => {
    it("should reschedule job after successful completion", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, { collectionName, pollInterval: 100 });
      monqueInstances.push(monque);
      await monque.initialize();
      const handlerCalls: Job[] = [];
      const handlerImplementation = (job: Job) => {
        handlerCalls.push(job);
      };
      const handler = vi.fn<typeof handlerImplementation>(handlerImplementation);
      monque.register(TEST_CONSTANTS.JOB_NAME, handler);
      // Schedule a job with a cron that runs every minute
      // We'll manually set nextRunAt to now so it runs immediately
      const job = await monque.schedule(TEST_CONSTANTS.CRON_EVERY_MINUTE, TEST_CONSTANTS.JOB_NAME, {
        testValue: "recurring",
      });
      const originalJobId = job._id;
      const completion: PromiseWithResolvers<void> = Promise.withResolvers();
      monque.on("job:complete", ({ job: completedJob }) => {
        if (completedJob._id?.equals(originalJobId) === true) {
          completion.resolve();
        }
      });
      // Update the job to run immediately for testing
      const collection = db.collection<Job>(collectionName);
      await triggerJobImmediately(collection, job._id);
      monque.start();
      // Wait for the first execution
      await waitFor(() => handlerCalls.length >= 1);
      await completion.promise;
      // Check that the job was rescheduled (still exists with pending status and new nextRunAt)
      const rescheduledJob = await collection.findOne({ _id: originalJobId });
      expect(rescheduledJob).toBeDefined();
      expect({
        rescheduledJobStatus: rescheduledJob?.status,
        rescheduledJobRepeatInterval: rescheduledJob?.repeatInterval,
      }).toStrictEqual({
        rescheduledJobStatus: JobStatus.PENDING,
        rescheduledJobRepeatInterval: TEST_CONSTANTS.CRON_EVERY_MINUTE,
      });
      // nextRunAt should be in the future
      expect(new Date(requireValue(rescheduledJob?.nextRunAt)).getTime()).toBeGreaterThan(
        Date.now(),
      );
    });

    it("should calculate next run from original cron timing", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, { collectionName, pollInterval: 100 });
      monqueInstances.push(monque);
      await monque.initialize();
      let processedJob: Job | null = null;
      const handlerImplementation = (job: Job) => {
        processedJob = job;
      };
      const handler = vi.fn<typeof handlerImplementation>(handlerImplementation);
      monque.register(TEST_CONSTANTS.JOB_NAME, handler);
      // Use a specific cron expression for predictable timing
      // Every hour at minute 0
      const cronExpression = "0 * * * *";
      const job = await monque.schedule(cronExpression, TEST_CONSTANTS.JOB_NAME, {});
      const originalJobId = job._id;
      // Update the job to run immediately for testing
      const collection = db.collection<Job>(collectionName);
      await triggerJobImmediately(collection, job._id);
      monque.start();
      await waitFor(() => processedJob !== null);
      // Check the rescheduled job's nextRunAt
      const rescheduledJob = await collection.findOne({ _id: originalJobId });
      expect(rescheduledJob).toBeDefined();
      // The next run should be at minute 0 (matching the cron pattern)
      const nextRunAt = new Date(requireValue(rescheduledJob?.nextRunAt));
      expect(nextRunAt.getMinutes()).toBe(0);
    });

    it("should reset failCount to 0 after successful completion", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, { collectionName, pollInterval: 100, maxRetries: 5 });
      monqueInstances.push(monque);
      await monque.initialize();
      let callCount = 0;
      const handlerImplementation = () => {
        callCount += 1;
        if (callCount === 1) {
          throw new Error("Simulated failure");
        }
      };
      const handler = vi.fn<typeof handlerImplementation>(handlerImplementation);
      monque.register(TEST_CONSTANTS.JOB_NAME, handler);
      // Schedule a recurring job
      const job = await monque.schedule(
        TEST_CONSTANTS.CRON_EVERY_MINUTE,
        TEST_CONSTANTS.JOB_NAME,
        {},
      );
      const originalJobId = job._id;
      // Update the job to run immediately
      const collection = db.collection<Job>(collectionName);
      await triggerJobImmediately(collection, job._id);
      monque.start();
      // Wait for first failure (will be retried with backoff)
      await waitFor(
        async () => {
          const doc = await collection.findOne({ _id: originalJobId });
          return doc?.failCount === 1;
        },
        { timeout: 5000 },
      );
      // Update nextRunAt to now to trigger retry immediately
      await triggerJobImmediately(collection, originalJobId);
      // Wait for successful completion
      await waitFor(
        async () => {
          const doc = await collection.findOne({ _id: originalJobId });
          // After success, failCount should be reset to 0
          return doc?.failCount === 0 && doc?.status === JobStatus.PENDING;
        },
        { timeout: 5000 },
      );
      const finalJob = await collection.findOne({ _id: originalJobId });
      expect({
        finalJobFailCount: finalJob?.failCount,
        finalJobStatus: finalJob?.status,
      }).toStrictEqual({
        finalJobFailCount: 0,
        finalJobStatus: JobStatus.PENDING,
      });
    });

    it("should preserve repeatInterval after retry failure", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, { collectionName, pollInterval: 100, maxRetries: 5 });
      monqueInstances.push(monque);
      await monque.initialize();
      const handler = vi.fn<() => Promise<void>>().mockRejectedValue(new Error("Always fails"));
      monque.register(TEST_CONSTANTS.JOB_NAME, handler);
      // Schedule a recurring job
      // Every 30 minutes
      const cronExpression = "*/30 * * * *";
      const job = await monque.schedule(cronExpression, TEST_CONSTANTS.JOB_NAME, {});
      const originalJobId = job._id;
      // Update the job to run immediately
      const collection = db.collection<Job>(collectionName);
      await triggerJobImmediately(collection, job._id);
      monque.start();
      // Wait for first failure
      await waitFor(
        async () => {
          const doc = await collection.findOne({ _id: originalJobId });
          return doc?.failCount === 1;
        },
        { timeout: 5000 },
      );
      // Check that repeatInterval is preserved after failure
      const failedJob = await collection.findOne({ _id: originalJobId });
      // Should be pending with backoff
      expect({
        failedJobRepeatInterval: failedJob?.repeatInterval,
        failedJobStatus: failedJob?.status,
      }).toStrictEqual({
        failedJobRepeatInterval: cronExpression,
        failedJobStatus: JobStatus.PENDING,
      });
    });

    it("should use cron timing for next run after successful retry (not backoff)", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, {
        collectionName,
        pollInterval: 100,
        maxRetries: 5,
        // 1 second base for backoff
        baseRetryInterval: 1000,
      });
      monqueInstances.push(monque);
      await monque.initialize();
      let callCount = 0;
      const handlerImplementation = () => {
        callCount += 1;
        if (callCount === 1) {
          throw new Error("First attempt fails");
        }
      };
      const handler = vi.fn<typeof handlerImplementation>(handlerImplementation);
      monque.register(TEST_CONSTANTS.JOB_NAME, handler);
      // Schedule a recurring job that runs hourly
      const cronExpression = "0 * * * *";
      const job = await monque.schedule(cronExpression, TEST_CONSTANTS.JOB_NAME, {});
      const originalJobId = job._id;
      // Update the job to run immediately
      const collection = db.collection<Job>(collectionName);
      await triggerJobImmediately(collection, job._id);
      monque.start();
      // Wait for first failure
      await waitFor(
        async () => {
          const doc = await collection.findOne({ _id: originalJobId });
          return doc?.failCount === 1;
        },
        { timeout: 5000 },
      );
      // Update nextRunAt to now to trigger retry immediately
      await triggerJobImmediately(collection, originalJobId);
      // Wait for successful completion
      await waitFor(
        async () => {
          const doc = await collection.findOne({ _id: originalJobId });
          return doc?.failCount === 0 && doc?.status === JobStatus.PENDING;
        },
        { timeout: 5000 },
      );
      // Check that nextRunAt follows cron timing, not backoff
      const finalJob = await collection.findOne({ _id: originalJobId });
      const nextRunAt = new Date(requireValue(finalJob?.nextRunAt));
      // Should be at minute 0 (cron pattern), not a small backoff delay
      expect(nextRunAt.getMinutes()).toBe(0);
      // Should be more than a few seconds in the future (cron timing, not immediate)
      expect(nextRunAt.getTime()).toBeGreaterThan(Date.now() + 1000);
    });

    it("should not reschedule one-time jobs after completion", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, { collectionName, pollInterval: 100 });
      monqueInstances.push(monque);
      await monque.initialize();
      let processed = false;
      const handlerImplementation = () => {
        processed = true;
      };
      const handler = vi.fn<typeof handlerImplementation>(handlerImplementation);
      monque.register(TEST_CONSTANTS.JOB_NAME, handler);
      // Enqueue a one-time job (not scheduled with cron)
      const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { oneTime: true });
      const originalJobId = job._id;
      monque.start();
      // Wait for completion
      await waitFor(() => processed);
      // Check that the job is completed, not rescheduled
      const collection = db.collection<Job>(collectionName);
      const completedJob = await collection.findOne({ _id: originalJobId });
      expect({
        completedJobStatus: completedJob?.status,
        completedJobRepeatInterval: completedJob?.repeatInterval,
      }).toStrictEqual({
        completedJobStatus: JobStatus.COMPLETED,
        completedJobRepeatInterval: undefined,
      });
    });

    it("should emit job:complete event for recurring jobs", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, { collectionName, pollInterval: 100 });
      monqueInstances.push(monque);
      await monque.initialize();
      const completedEvents: {
        job: Job;
        duration: number;
      }[] = [];
      monque.on("job:complete", (event) => {
        completedEvents.push(event);
      });
      const handler = vi.fn<() => void>();
      monque.register(TEST_CONSTANTS.JOB_NAME, handler);
      // Schedule a recurring job
      const job = await monque.schedule(
        TEST_CONSTANTS.CRON_EVERY_MINUTE,
        TEST_CONSTANTS.JOB_NAME,
        {},
      );
      // Update the job to run immediately
      const collection = db.collection<Job>(collectionName);
      await triggerJobImmediately(collection, job._id);
      monque.start();
      // Wait for completion event
      await waitFor(() => completedEvents.length >= 1);
      expect(completedEvents).toHaveLength(1);
      const [firstEvent] = completedEvents;
      expect(firstEvent).toBeDefined();
      expect(firstEvent?.job.name).toBe(TEST_CONSTANTS.JOB_NAME);
      expect(firstEvent?.duration).toBeGreaterThanOrEqual(0);
    });

    it("should clear failReason after successful completion", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, { collectionName, pollInterval: 100, maxRetries: 5 });
      monqueInstances.push(monque);
      await monque.initialize();
      let callCount = 0;
      const handlerImplementation = () => {
        callCount += 1;
        if (callCount === 1) {
          throw new Error("Test failure reason");
        }
      };
      const handler = vi.fn<typeof handlerImplementation>(handlerImplementation);
      monque.register(TEST_CONSTANTS.JOB_NAME, handler);
      // Schedule a recurring job
      const job = await monque.schedule(
        TEST_CONSTANTS.CRON_EVERY_MINUTE,
        TEST_CONSTANTS.JOB_NAME,
        {},
      );
      const originalJobId = job._id;
      // Update the job to run immediately
      const collection = db.collection<Job>(collectionName);
      await triggerJobImmediately(collection, job._id);
      monque.start();
      // Wait for first failure
      await waitFor(
        async () => {
          const doc = await collection.findOne({ _id: originalJobId });
          return doc?.failCount === 1 && doc?.failReason === "Test failure reason";
        },
        { timeout: 5000 },
      );
      // Update nextRunAt to now to trigger retry immediately
      await triggerJobImmediately(collection, originalJobId);
      // Wait for successful completion (failCount reset, failReason cleared)
      await waitFor(
        async () => {
          const doc = await collection.findOne({ _id: originalJobId });
          return doc?.failCount === 0 && doc?.status === JobStatus.PENDING;
        },
        { timeout: 5000 },
      );
      const finalJob = await collection.findOne({ _id: originalJobId });
      expect({
        finalJobFailCount: finalJob?.failCount,
        finalJobFailReason: finalJob?.failReason,
      }).toStrictEqual({
        finalJobFailCount: 0,
        finalJobFailReason: undefined,
      });
    });
  });
  describe("data integrity", () => {
    it("should preserve job data through scheduling", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const complexData = {
        string: "test",
        number: 42,
        boolean: true,
        nested: { key: "value" },
        array: [1, 2, 3],
      };
      const job = await monque.schedule(
        TEST_CONSTANTS.CRON_EVERY_MINUTE,
        TEST_CONSTANTS.JOB_NAME,
        complexData,
      );
      expect(job.data).toStrictEqual(complexData);
      // Verify from database
      const collection = db.collection<Job>(collectionName);
      const dbJob = await collection.findOne({ _id: job._id });
      expect(dbJob?.data).toStrictEqual(complexData);
    });
  });
  describe("error handling", () => {
    it("should throw if scheduler is not initialized", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      // Do NOT call monque.initialize()
      await expect(
        monque.schedule(TEST_CONSTANTS.CRON_EVERY_MINUTE, TEST_CONSTANTS.JOB_NAME, {}),
      ).rejects.toThrow("not initialized");
    });
  });
});
