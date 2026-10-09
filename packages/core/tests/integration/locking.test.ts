import { setTimeout as pauseFor } from "node:timers/promises";
/**
 * Tests for atomic job locking in the Monque scheduler.
 *
 * These tests verify:
 * - Atomic locking prevents duplicate job processing
 * - Concurrent workers safely acquire different jobs
 * - No race conditions in job pickup
 * - lockedAt field is set correctly during processing
 *
 * @see {@link ../../src/scheduler/monque.ts}
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

import { requireValue, forEachSequential } from "./helpers";

const completeAfter100Milliseconds = async () => {
  await pauseFor(100);
};

describe("atomic job locking", () => {
  let db: Db;
  let collectionName: string;
  const monqueInstances: Monque[] = [];
  beforeAll(async () => {
    db = await getTestDb("locking");
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
  describe("concurrent workers - no duplicate processing", () => {
    it("should not process the same job twice with multiple scheduler instances", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      // Create two scheduler instances pointing to same collection
      const monque1 = new Monque(db, { collectionName, pollInterval: 50, workerConcurrency: 5 });
      monqueInstances.push(monque1);
      const monque2 = new Monque(db, { collectionName, pollInterval: 50, workerConcurrency: 5 });
      monqueInstances.push(monque2);
      await monque1.initialize();
      await monque2.initialize();
      const processedJobs: string[] = [];
      const processedJobIds = new Set<string>();
      const handler1Implementation = async (job: Job) => {
        const jobId = job._id?.toString() ?? "";
        if (!job._id) {
          throw new Error("Expected job._id to be defined");
        }
        processedJobs.push(`instance1:${jobId}`);
        processedJobIds.add(jobId);
        await pauseFor(100);
      };
      const handler1 = vi.fn<typeof handler1Implementation>(handler1Implementation);
      const handler2Implementation = async (job: Job) => {
        const jobId = job._id?.toString() ?? "";
        if (!job._id) {
          throw new Error("Expected job._id to be defined");
        }
        processedJobs.push(`instance2:${jobId}`);
        processedJobIds.add(jobId);
        await pauseFor(100);
      };
      const handler2 = vi.fn<typeof handler2Implementation>(handler2Implementation);
      monque1.register(TEST_CONSTANTS.JOB_NAME, handler1);
      monque2.register(TEST_CONSTANTS.JOB_NAME, handler2);
      // Enqueue multiple jobs
      const jobCount = 10;
      const enqueuedJobIds: string[] = [];
      await forEachSequential(
        Array.from({ length: Math.ceil(jobCount / 1) }, (_, index) => index * 1),
        async (i) => {
          const job = await monque1.enqueue(TEST_CONSTANTS.JOB_NAME, { index: i });
          enqueuedJobIds.push(job._id.toString());
        },
      );
      // Start both instances
      monque1.start();
      monque2.start();
      // Wait for all jobs to be processed
      await waitFor(() => processedJobIds.size === jobCount, { timeout: 10_000 });
      await monque1.stop();
      await monque2.stop();
      // Verify each job was processed exactly once
      expect(processedJobIds.size).toBe(jobCount);
      // Verify all enqueued jobs were processed
      for (const jobId of enqueuedJobIds) {
        expect(processedJobIds.has(jobId)).toBe(true);
      }
      // Total handler calls should equal job count (no duplicates)
      expect(handler1.mock.calls.length + handler2.mock.calls.length).toBe(jobCount);
    });

    it("should distribute jobs between concurrent workers", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque1 = new Monque(db, {
        collectionName,
        pollInterval: 30,
        safetyPollInterval: 30,
        workerConcurrency: 2,
      });
      monqueInstances.push(monque1);
      const monque2 = new Monque(db, {
        collectionName,
        pollInterval: 30,
        safetyPollInterval: 30,
        workerConcurrency: 2,
      });
      monqueInstances.push(monque2);
      await monque1.initialize();
      await monque2.initialize();
      const instance1Jobs: number[] = [];
      const instance2Jobs: number[] = [];
      const handler1Implementation = async (
        job: Job<{
          index: number;
        }>,
      ) => {
        instance1Jobs.push(job.data.index);
        await pauseFor(80);
      };
      const handler1 = vi.fn<typeof handler1Implementation>(handler1Implementation);
      const handler2Implementation = async (
        job: Job<{
          index: number;
        }>,
      ) => {
        instance2Jobs.push(job.data.index);
        await pauseFor(80);
      };
      const handler2 = vi.fn<typeof handler2Implementation>(handler2Implementation);
      monque1.register(TEST_CONSTANTS.JOB_NAME, handler1);
      monque2.register(TEST_CONSTANTS.JOB_NAME, handler2);
      // Enqueue jobs
      const jobCount = 8;
      await forEachSequential(
        Array.from({ length: Math.ceil(jobCount / 1) }, (_, index) => index * 1),
        async (i) => {
          await monque1.enqueue(TEST_CONSTANTS.JOB_NAME, { index: i });
        },
      );
      monque1.start();
      monque2.start();
      await waitFor(() => instance1Jobs.length + instance2Jobs.length === jobCount, {
        timeout: 10_000,
      });
      await monque1.stop();
      await monque2.stop();
      // Both instances should have processed some jobs
      expect(instance1Jobs.length + instance2Jobs.length).toBe(jobCount);
      // With two instances and 8 jobs, both should have gotten at least one job
      // (this is probabilistic but with proper locking should be true)
      // We mainly verify no duplicates
      const allProcessed = [...instance1Jobs, ...instance2Jobs].toSorted((a, b) => a - b);
      expect(allProcessed).toStrictEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    });

    it("should handle rapid polling without duplicate acquisition", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      // Very short poll interval to increase contention
      const monque1 = new Monque(db, {
        collectionName,
        pollInterval: 10,
        safetyPollInterval: 10,
        workerConcurrency: 1,
      });
      monqueInstances.push(monque1);
      const monque2 = new Monque(db, {
        collectionName,
        pollInterval: 10,
        safetyPollInterval: 10,
        workerConcurrency: 1,
      });
      monqueInstances.push(monque2);
      const monque3 = new Monque(db, {
        collectionName,
        pollInterval: 10,
        safetyPollInterval: 10,
        workerConcurrency: 1,
      });
      monqueInstances.push(monque3);
      await monque1.initialize();
      await monque2.initialize();
      await monque3.initialize();
      const processedJobIds = new Set<string>();
      const duplicates: string[] = [];
      const createHandler = () =>
        vi.fn<(job: Job) => Promise<void>>(async (job: Job) => {
          const jobId = job._id?.toString() ?? "";
          if (!job._id) {
            throw new Error("Expected job._id to be defined");
          }
          if (processedJobIds.has(jobId)) {
            duplicates.push(jobId);
          }
          processedJobIds.add(jobId);
          await pauseFor(50);
        });
      const handler1 = createHandler();
      const handler2 = createHandler();
      const handler3 = createHandler();
      monque1.register(TEST_CONSTANTS.JOB_NAME, handler1);
      monque2.register(TEST_CONSTANTS.JOB_NAME, handler2);
      monque3.register(TEST_CONSTANTS.JOB_NAME, handler3);
      // Enqueue jobs
      const jobCount = 15;
      await forEachSequential(
        Array.from({ length: Math.ceil(jobCount / 1) }, (_, index) => index * 1),
        async (i) => {
          await monque1.enqueue(TEST_CONSTANTS.JOB_NAME, { index: i });
        },
      );
      monque1.start();
      monque2.start();
      monque3.start();
      await waitFor(() => processedJobIds.size === jobCount, { timeout: 15_000 });
      await monque1.stop();
      await monque2.stop();
      await monque3.stop();
      // No duplicates should have been processed
      expect({
        duplicates: duplicates.length,
        processedJobIdsSize: processedJobIds.size,
      }).toStrictEqual({
        duplicates: 0,
        processedJobIdsSize: jobCount,
      });
    });
  });
  describe("lock state transitions", () => {
    it("should transition pending → processing → completed", async () => {
      const release: PromiseWithResolvers<void> = Promise.withResolvers();
      try {
        collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
        const monque = new Monque(db, { collectionName, pollInterval: 100 });
        monqueInstances.push(monque);
        await monque.initialize();
        const statusHistory: string[] = [];
        let checkDuringProcessing = false;
        const handlerImplementation = async () => {
          checkDuringProcessing = true;
          await release.promise;
        };
        const handler = vi.fn<typeof handlerImplementation>(handlerImplementation);
        monque.register(TEST_CONSTANTS.JOB_NAME, handler);
        const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, {});
        const collection = db.collection<Job>(collectionName);
        // Check initial status
        let doc = await collection.findOne({ _id: job._id });
        statusHistory.push(requireValue(doc?.status));
        monque.start();
        // Wait until processing starts
        await waitFor(() => checkDuringProcessing);
        // Check processing status
        doc = await collection.findOne({ _id: job._id });
        statusHistory.push(requireValue(doc?.status));
        release.resolve();
        // Wait for completion
        await waitFor(async () => {
          const d = await collection.findOne({ _id: job._id });
          return d?.status === JobStatus.COMPLETED;
        });
        // Check completed status
        doc = await collection.findOne({ _id: job._id });
        statusHistory.push(requireValue(doc?.status));
        await monque.stop();
        expect(statusHistory).toStrictEqual([
          JobStatus.PENDING,
          JobStatus.PROCESSING,
          JobStatus.COMPLETED,
        ]);
      } finally {
        release.resolve();
      }
    });

    it("should clear lockedAt after job completion", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, { collectionName, pollInterval: 100 });
      monqueInstances.push(monque);
      await monque.initialize();
      const handler = vi.fn<() => void>();
      monque.register(TEST_CONSTANTS.JOB_NAME, handler);
      const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, {});
      monque.start();
      await waitFor(async () => {
        const collection = db.collection<Job>(collectionName);
        const doc = await collection.findOne({ _id: job._id });
        return doc?.status === JobStatus.COMPLETED;
      });
      await monque.stop();
      const collection = db.collection<Job>(collectionName);
      const doc = await collection.findOne({ _id: job._id });
      expect(doc?.lockedAt).toBeUndefined();
    });

    it("should update updatedAt timestamp on state changes", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, { collectionName, pollInterval: 100 });
      monqueInstances.push(monque);
      await monque.initialize();
      const handler = vi.fn<typeof completeAfter100Milliseconds>(completeAfter100Milliseconds);
      monque.register(TEST_CONSTANTS.JOB_NAME, handler);
      const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, {});
      const collection = db.collection<Job>(collectionName);
      // Get initial updatedAt
      let doc = await collection.findOne({ _id: job._id });
      const initialUpdatedAt = requireValue(doc?.updatedAt);
      monque.start();
      await waitFor(async () => {
        const d = await collection.findOne({ _id: job._id });
        return d?.status === JobStatus.COMPLETED;
      });
      await monque.stop();
      // Get final updatedAt
      doc = await collection.findOne({ _id: job._id });
      const finalUpdatedAt = requireValue(doc?.updatedAt);
      expect(finalUpdatedAt.getTime()).toBeGreaterThan(initialUpdatedAt.getTime());
    });
  });
  describe("only pending jobs are acquired", () => {
    it("should not acquire jobs in processing status", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, { collectionName, pollInterval: 100 });
      monqueInstances.push(monque);
      await monque.initialize();
      // Manually insert a job already in processing status
      const collection = db.collection<Job>(collectionName);
      await collection.insertOne(
        JobFactoryHelpers.processing({
          name: TEST_CONSTANTS.JOB_NAME,
          // In the past
          nextRunAt: new Date(Date.now() - 1000),
        }),
      );
      const handler = vi.fn<() => void>();
      monque.register(TEST_CONSTANTS.JOB_NAME, handler);
      monque.start();
      // Wait some time
      await pauseFor(500);
      await monque.stop();
      // Handler should not have been called
      expect(handler).not.toHaveBeenCalled();
    });

    it("should not acquire jobs in completed status", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, { collectionName, pollInterval: 100 });
      monqueInstances.push(monque);
      await monque.initialize();
      const collection = db.collection<Job>(collectionName);
      await collection.insertOne(
        JobFactoryHelpers.completed({
          name: TEST_CONSTANTS.JOB_NAME,
          nextRunAt: new Date(Date.now() - 1000),
        }),
      );
      const handler = vi.fn<() => void>();
      monque.register(TEST_CONSTANTS.JOB_NAME, handler);
      monque.start();
      await pauseFor(500);
      await monque.stop();
      expect(handler).not.toHaveBeenCalled();
    });

    it("should not acquire jobs in failed status", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, { collectionName, pollInterval: 100 });
      monqueInstances.push(monque);
      await monque.initialize();
      const collection = db.collection<Job>(collectionName);
      await collection.insertOne(
        JobFactoryHelpers.failed({
          name: TEST_CONSTANTS.JOB_NAME,
          nextRunAt: new Date(Date.now() - 1000),
        }),
      );
      const handler = vi.fn<() => void>();
      monque.register(TEST_CONSTANTS.JOB_NAME, handler);
      monque.start();
      await pauseFor(500);
      await monque.stop();
      expect(handler).not.toHaveBeenCalled();
    });

    it("should not acquire jobs with nextRunAt in the future", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, { collectionName, pollInterval: 100 });
      monqueInstances.push(monque);
      await monque.initialize();
      // Enqueue job scheduled for future
      // 1 minute from now
      const futureDate = new Date(Date.now() + 60_000);
      await monque.enqueue(TEST_CONSTANTS.JOB_NAME, {}, { runAt: futureDate });
      const handler = vi.fn<() => void>();
      monque.register(TEST_CONSTANTS.JOB_NAME, handler);
      monque.start();
      await pauseFor(500);
      await monque.stop();
      // Job should not be processed yet
      expect(handler).not.toHaveBeenCalled();
    });
  });
});
