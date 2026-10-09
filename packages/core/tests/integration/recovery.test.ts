/**
 * Tests for job recovery and cleanup in the Monque scheduler.
 *
 * These tests verify:
 * - Stale job recovery on initialization
 * - Emission of stale:recovered event
 * - Cleanup of failReason on successful completion
 *
 * @see {@link ../../src/scheduler/monque.ts}
 */
import type { Db } from "mongodb";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import type { Job } from "@/jobs";
import { JobStatus } from "@/jobs";
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
import { JobFactory, JobFactoryHelpers } from "@tests/factories/job.factory.js";

describe("recovery and cleanup", () => {
  let db: Db;
  let collectionName: string;
  const monqueInstances: Monque[] = [];
  beforeAll(async () => {
    db = await getTestDb("recovery");
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
  describe("stale job recovery", () => {
    it("should recover stale jobs and emit stale:recovered event", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      // Use a short lock timeout for testing
      const monque = new Monque(db, {
        collectionName,
        lockTimeout: 1000,
        recoverStaleJobs: true,
      });
      monqueInstances.push(monque);
      // We need to initialize the collection first to insert data
      // But we want to test recovery during initialize(), so we'll use a separate instance or direct DB access
      // Since initialize() creates indexes, we can just use direct DB access to insert data
      const collection = db.collection<Job>(collectionName);
      const now = new Date();
      // Older than lockTimeout (1000ms)
      const staleTime = new Date(now.getTime() - 2000);
      await collection.insertOne(
        JobFactoryHelpers.processing({
          name: TEST_CONSTANTS.JOB_NAME,
          nextRunAt: staleTime,
          lockedAt: staleTime,
          createdAt: staleTime,
          updatedAt: staleTime,
        }),
      );
      const staleRecoveredSpy = vi.fn<() => void>();
      monque.on("stale:recovered", staleRecoveredSpy);
      await monque.initialize();
      expect(staleRecoveredSpy).toHaveBeenCalledExactlyOnceWith({ count: 1 });
      // Verify job is reset to pending
      const job = await collection.findOne({ name: TEST_CONSTANTS.JOB_NAME });
      expect({
        jobStatus: job?.status,
        jobLockedAt: job?.lockedAt,
      }).toStrictEqual({
        jobStatus: JobStatus.PENDING,
        jobLockedAt: undefined,
      });
    });

    it("should not recover non-stale jobs", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, {
        collectionName,
        lockTimeout: 5000,
        recoverStaleJobs: true,
      });
      monqueInstances.push(monque);
      const collection = db.collection<Job>(collectionName);
      const now = new Date();
      // Newer than lockTimeout (5000ms)
      const activeTime = new Date(now.getTime() - 1000);
      await collection.insertOne(
        JobFactoryHelpers.processing({
          name: TEST_CONSTANTS.JOB_NAME,
          nextRunAt: activeTime,
          lockedAt: activeTime,
          createdAt: activeTime,
          updatedAt: activeTime,
        }),
      );
      const staleRecoveredSpy = vi.fn<() => void>();
      monque.on("stale:recovered", staleRecoveredSpy);
      await monque.initialize();
      expect(staleRecoveredSpy).not.toHaveBeenCalled();
      // Verify job remains processing
      const job = await collection.findOne({ name: TEST_CONSTANTS.JOB_NAME });
      expect(job?.status).toBe(JobStatus.PROCESSING);
      expect(job?.lockedAt).not.toBeNull();
    });
  });
  describe("failReason cleanup", () => {
    it("should remove failReason on successful completion", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, { collectionName, pollInterval: 100 });
      monqueInstances.push(monque);
      await monque.initialize();
      const collection = db.collection<Job>(collectionName);
      // Insert a job that has failed previously
      const result = await collection.insertOne(
        JobFactory.build({
          name: TEST_CONSTANTS.JOB_NAME,
          failCount: 1,
          failReason: "Previous error",
        }),
      );
      const jobId = result.insertedId;
      const handler = vi.fn<() => void>();
      monque.register(TEST_CONSTANTS.JOB_NAME, handler);
      monque.start();
      await waitFor(async () => {
        const doc = await collection.findOne({ _id: jobId });
        return doc?.status === JobStatus.COMPLETED;
      });
      const job = await collection.findOne({ _id: jobId });
      // Fail count is preserved for one-time jobs to show history of failures before success
      expect({
        jobStatus: job?.status,
        jobFailCount: job?.failCount,
      }).toStrictEqual({
        jobStatus: JobStatus.COMPLETED,
        jobFailCount: 1,
      });
      expect(job).not.toHaveProperty("failReason");
    });

    it("should remove failReason on successful completion of recurring job", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, { collectionName, pollInterval: 100 });
      monqueInstances.push(monque);
      await monque.initialize();
      const collection = db.collection<Job>(collectionName);
      // Insert a recurring job that has failed previously
      const result = await collection.insertOne(
        JobFactory.build({
          name: TEST_CONSTANTS.JOB_NAME,
          // Every minute
          repeatInterval: "* * * * *",
          failCount: 1,
          failReason: "Previous error",
        }),
      );
      const jobId = result.insertedId;
      const handler = vi.fn<() => void>();
      monque.register(TEST_CONSTANTS.JOB_NAME, handler);
      monque.start();
      await waitFor(async () => {
        const doc = await collection.findOne({ _id: jobId });
        // For recurring jobs, status goes back to PENDING
        // We can check if failCount is reset to 0
        return doc?.status === JobStatus.PENDING && doc?.failCount === 0;
      });
      const job = await collection.findOne({ _id: jobId });
      expect({
        jobStatus: job?.status,
        jobFailCount: job?.failCount,
      }).toStrictEqual({
        jobStatus: JobStatus.PENDING,
        jobFailCount: 0,
      });
      expect(job).not.toHaveProperty("failReason");
    });
  });
});
