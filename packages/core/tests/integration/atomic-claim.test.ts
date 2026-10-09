import { setTimeout as pauseFor } from "node:timers/promises";
/**
 * Tests for atomic job claiming using the claimedBy field.
 *
 * These tests verify:
 * - Jobs are claimed atomically using claimedBy field
 * - Only one scheduler instance can claim a job
 * - Concurrent claim attempts result in only one success
 * - claimedBy is set when job is acquired
 * - claimedBy is cleared when job completes or fails
 */
import type { Db } from "mongodb";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

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

import { forEachSequential } from "./helpers";

describe("atomic job claiming", () => {
  let db: Db;
  let collectionName: string;
  const monqueInstances: Monque[] = [];
  beforeAll(async () => {
    db = await getTestDb("atomic-claim");
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
  describe("claimedBy field behavior", () => {
    it("should set claimedBy to scheduler instance ID when acquiring a job", async () => {
      const release: PromiseWithResolvers<void> = Promise.withResolvers();
      try {
        collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
        const instanceId = "test-instance-123";
        const monque = new Monque(db, {
          collectionName,
          pollInterval: 100,
          schedulerInstanceId: instanceId,
        });
        monqueInstances.push(monque);
        await monque.initialize();
        let processedJob: Job | null = null;
        monque.register(TEST_CONSTANTS.JOB_NAME, async (job) => {
          processedJob = job;
          // Hold the job to verify claimedBy while processing
          await release.promise;
        });
        await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { value: 1 });
        monque.start();
        // Wait for job to start processing
        await waitFor(() => processedJob !== null, { timeout: 5000 });
        // Check claimedBy in database while job is processing
        const collection = db.collection<Job>(collectionName);
        const doc = await collection.findOne({ name: TEST_CONSTANTS.JOB_NAME });
        expect({
          docStatus: doc?.status,
          docClaimedBy: doc?.claimedBy,
        }).toStrictEqual({
          docStatus: JobStatus.PROCESSING,
          docClaimedBy: instanceId,
        });
        expect(doc?.lockedAt).toBeInstanceOf(Date);
      } finally {
        release.resolve();
      }
    });

    it("should clear claimedBy when job completes successfully", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const instanceId = "test-instance-456";
      const monque = new Monque(db, {
        collectionName,
        pollInterval: 100,
        schedulerInstanceId: instanceId,
      });
      monqueInstances.push(monque);
      await monque.initialize();
      let completed = false;
      monque.on("job:complete", () => {
        completed = true;
      });
      monque.register(TEST_CONSTANTS.JOB_NAME, () => {});
      const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { value: 1 });
      monque.start();
      await waitFor(() => completed, { timeout: 5000 });
      const collection = db.collection<Job>(collectionName);
      const doc = await collection.findOne({ _id: job._id });
      expect({
        docStatus: doc?.status,
        docClaimedBy: doc?.claimedBy,
      }).toStrictEqual({
        docStatus: JobStatus.COMPLETED,
        docClaimedBy: undefined,
      });
    });

    it("should clear claimedBy when job fails permanently", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const instanceId = "test-instance-789";
      const monque = new Monque(db, {
        collectionName,
        pollInterval: 100,
        schedulerInstanceId: instanceId,
        // Fail immediately after first attempt
        maxRetries: 1,
      });
      monqueInstances.push(monque);
      await monque.initialize();
      let permanentlyFailed = false;
      monque.on("job:fail", ({ willRetry }) => {
        if (!willRetry) {
          permanentlyFailed = true;
        }
      });
      monque.register(TEST_CONSTANTS.JOB_NAME, () => {
        throw new Error("Intentional failure");
      });
      const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { value: 1 });
      monque.start();
      await waitFor(() => permanentlyFailed, { timeout: 5000 });
      const collection = db.collection<Job>(collectionName);
      const doc = await collection.findOne({ _id: job._id });
      expect({
        docStatus: doc?.status,
        docClaimedBy: doc?.claimedBy,
      }).toStrictEqual({
        docStatus: JobStatus.FAILED,
        docClaimedBy: undefined,
      });
    });

    it("should clear claimedBy when job fails but will retry", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const instanceId = "test-instance-retry";
      const monque = new Monque(db, {
        collectionName,
        pollInterval: 100,
        schedulerInstanceId: instanceId,
        maxRetries: 3,
      });
      monqueInstances.push(monque);
      await monque.initialize();
      let failedWithRetry = false;
      monque.on("job:fail", ({ willRetry }) => {
        if (willRetry) {
          failedWithRetry = true;
        }
      });
      let attempts = 0;
      monque.register(TEST_CONSTANTS.JOB_NAME, () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("First attempt fails");
        }
      });
      const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { value: 1 });
      monque.start();
      await waitFor(() => failedWithRetry, { timeout: 5000 });
      await monque.stop();
      const collection = db.collection<Job>(collectionName);
      const doc = await collection.findOne({ _id: job._id });
      expect({
        docStatus: doc?.status,
        docClaimedBy: doc?.claimedBy,
        docFailCount: doc?.failCount,
      }).toStrictEqual({
        docStatus: JobStatus.PENDING,
        docClaimedBy: undefined,
        docFailCount: 1,
      });
    });
  });
  describe("concurrent claim attempts", () => {
    it("should allow only one instance to claim a job when multiple attempt simultaneously", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const instance1Id = "instance-1";
      const instance2Id = "instance-2";
      const instance3Id = "instance-3";
      const monque1 = new Monque(db, {
        collectionName,
        pollInterval: 50,
        schedulerInstanceId: instance1Id,
        workerConcurrency: 1,
      });
      const monque2 = new Monque(db, {
        collectionName,
        pollInterval: 50,
        schedulerInstanceId: instance2Id,
        workerConcurrency: 1,
      });
      const monque3 = new Monque(db, {
        collectionName,
        pollInterval: 50,
        schedulerInstanceId: instance3Id,
        workerConcurrency: 1,
      });
      monqueInstances.push(monque1, monque2, monque3);
      await monque1.initialize();
      await monque2.initialize();
      await monque3.initialize();
      const claimedBy = new Set<string>();
      const processedJobIds = new Set<string>();
      const duplicates: string[] = [];
      const createHandler =
        (instanceName: string) =>
        async (
          job: Job<{
            id: number;
          }>,
        ) => {
          const jobId = job._id?.toString() ?? "";
          if (processedJobIds.has(jobId)) {
            duplicates.push(`${jobId} by ${instanceName}`);
          }
          processedJobIds.add(jobId);
          claimedBy.add(instanceName);
          await pauseFor(50);
        };
      monque1.register(TEST_CONSTANTS.JOB_NAME, createHandler("instance-1"));
      monque2.register(TEST_CONSTANTS.JOB_NAME, createHandler("instance-2"));
      monque3.register(TEST_CONSTANTS.JOB_NAME, createHandler("instance-3"));
      // Enqueue a single job
      await monque1.enqueue(TEST_CONSTANTS.JOB_NAME, { id: 1 });
      // Start all instances simultaneously
      monque1.start();
      monque2.start();
      monque3.start();
      // Wait for job to be processed
      await waitFor(() => processedJobIds.size === 1, { timeout: 5000 });
      // Verify no duplicates
      // Exactly one instance should have claimed the job
      expect({
        duplicates: duplicates.length,
        claimedBySize: claimedBy.size,
      }).toStrictEqual({
        duplicates: 0,
        claimedBySize: 1,
      });
    });

    it("should distribute multiple jobs across instances without duplicates", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const jobCount = 20;
      const monque1 = new Monque(db, {
        collectionName,
        pollInterval: 30,
        safetyPollInterval: 30,
        schedulerInstanceId: "dist-instance-1",
        workerConcurrency: 3,
      });
      const monque2 = new Monque(db, {
        collectionName,
        pollInterval: 30,
        safetyPollInterval: 30,
        schedulerInstanceId: "dist-instance-2",
        workerConcurrency: 3,
      });
      monqueInstances.push(monque1, monque2);
      await monque1.initialize();
      await monque2.initialize();
      const processedJobs = new Set<number>();
      const duplicateJobs = new Set<number>();
      const instance1Jobs: number[] = [];
      const instance2Jobs: number[] = [];
      const handler1 = async (
        job: Job<{
          id: number;
        }>,
      ) => {
        const { id } = job.data;
        if (processedJobs.has(id)) {
          duplicateJobs.add(id);
        }
        processedJobs.add(id);
        instance1Jobs.push(id);
        await pauseFor(20);
      };
      const handler2 = async (
        job: Job<{
          id: number;
        }>,
      ) => {
        const { id } = job.data;
        if (processedJobs.has(id)) {
          duplicateJobs.add(id);
        }
        processedJobs.add(id);
        instance2Jobs.push(id);
        await pauseFor(20);
      };
      monque1.register(TEST_CONSTANTS.JOB_NAME, handler1);
      monque2.register(TEST_CONSTANTS.JOB_NAME, handler2);
      // Enqueue jobs
      await forEachSequential(
        Array.from({ length: Math.ceil(jobCount / 1) }, (_, index) => index * 1),
        async (i) => {
          await monque1.enqueue(TEST_CONSTANTS.JOB_NAME, { id: i });
        },
      );
      monque1.start();
      monque2.start();
      await waitFor(() => processedJobs.size === jobCount, { timeout: 10_000 });
      // Both instances should have processed some jobs (distribution)
      expect({
        processedJobsSize: processedJobs.size,
        duplicateJobsSize: duplicateJobs.size,
        instance1JobsLengthInstance2JobsLength: instance1Jobs.length + instance2Jobs.length,
      }).toStrictEqual({
        processedJobsSize: jobCount,
        duplicateJobsSize: 0,
        instance1JobsLengthInstance2JobsLength: jobCount,
      });
      // Wait for database to reflect all completions
      await waitFor(
        async () => {
          const count = await db
            .collection<Job>(collectionName)
            .countDocuments({ status: JobStatus.COMPLETED });
          return count === jobCount;
        },
        { timeout: 5000 },
      );
      const completedCount = await db
        .collection<Job>(collectionName)
        .countDocuments({ status: JobStatus.COMPLETED });
      expect(completedCount).toBe(jobCount);
    });
  });
  describe("claim query behavior", () => {
    it("should not claim jobs already claimed by another instance", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      // Create a job and manually set it as claimed by another instance
      const collection = db.collection<Job>(collectionName);
      const now = new Date();
      const claimedJob = JobFactoryHelpers.processing({
        name: TEST_CONSTANTS.JOB_NAME,
        data: { value: 1 },
        nextRunAt: new Date(now.getTime() - 1000),
        claimedBy: "other-instance",
        lockedAt: now,
        lastHeartbeat: now,
        createdAt: now,
        updatedAt: now,
      });
      await collection.insertOne(claimedJob);
      const monque = new Monque(db, {
        collectionName,
        pollInterval: 100,
        schedulerInstanceId: "new-instance",
      });
      monqueInstances.push(monque);
      await monque.initialize();
      const handler = vi.fn<() => void>();
      monque.register(TEST_CONSTANTS.JOB_NAME, handler);
      monque.start();
      // Wait a bit to ensure polling happens
      await pauseFor(500);
      await monque.stop();
      // Handler should not have been called since job is claimed by another
      expect(handler).not.toHaveBeenCalled();
      // Verify job is still claimed by other instance
      const doc = await collection.findOne({ name: TEST_CONSTANTS.JOB_NAME });
      expect(doc?.claimedBy).toBe("other-instance");
    });
  });
});
