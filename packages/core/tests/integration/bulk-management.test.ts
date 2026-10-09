import type { Db } from "mongodb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";

import { JobStatus } from "@/jobs";
import type { Job } from "@/jobs";
import { Monque } from "@/scheduler";
import {
  cleanupTestDb,
  getTestDb,
  stopMonqueInstances,
  uniqueCollectionName,
} from "@test-utils/test-utils";
import { JobFactoryHelpers } from "@tests/factories";

import { requireValue } from "./helpers";

describe("Management APIs: Bulk Operations", () => {
  let db: Db;
  let monque: Monque;
  const monqueInstances: Monque[] = [];
  const queueName = "bulk-management-test-queue";
  beforeAll(async () => {
    db = await getTestDb("bulk-management-api");
  });

  afterEach(async () => {
    await stopMonqueInstances(monqueInstances);
  });

  afterAll(async () => {
    await cleanupTestDb(db);
  });
  describe("cancelJobs", () => {
    it("cancels all matching jobs by name and status", async () => {
      const collectionName = uniqueCollectionName("bulk_cancel_match");
      monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      // Create jobs to cancel
      await monque.enqueue(queueName, { task: 1 });
      await monque.enqueue(queueName, { task: 2 });
      await monque.enqueue(queueName, { task: 3 });
      // Create a job with different name that should NOT be cancelled
      await monque.enqueue("other-queue", { task: 4 });
      const result = await monque.cancelJobs({
        name: queueName,
        status: JobStatus.PENDING,
      });
      expect({
        resultCount: result.count,
        resultErrors: result.errors.length,
      }).toStrictEqual({
        resultCount: 3,
        resultErrors: 0,
      });
      // Verify in DB
      const cancelledDocs = await db
        .collection<Job>(collectionName)
        .find({ name: queueName })
        .toArray();
      const cancelled = requireValue(cancelledDocs);
      expect(cancelled.every((job) => job.status === JobStatus.CANCELLED)).toBe(true);
      // Verify other queue job is still pending
      const otherDoc = await db.collection<Job>(collectionName).findOne({ name: "other-queue" });
      const other = requireValue(otherDoc);
      expect(other?.status).toBe(JobStatus.PENDING);
    });

    it("only cancels pending jobs, ignoring other statuses", async () => {
      const collectionName = uniqueCollectionName("bulk_cancel_skip");
      monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      // Create a pending job
      await monque.enqueue(queueName, { task: 1 });
      // Create a processing job (directly in DB)
      const processingDoc = JobFactoryHelpers.processing({
        name: queueName,
        data: { task: 2 },
      });
      await db.collection<Job>(collectionName).insertOne(processingDoc);
      const result = await monque.cancelJobs({
        name: queueName,
      });
      // Only the pending one should be cancelled; processing silently skipped
      expect({
        resultCount: result.count,
        resultErrors: result.errors.length,
      }).toStrictEqual({
        resultCount: 1,
        resultErrors: 0,
      });
      // Verify processing job is untouched
      const processingInDb = await db
        .collection<Job>(collectionName)
        .findOne({ _id: processingDoc._id });
      const processing = requireValue(processingInDb);
      expect(processing?.status).toBe(JobStatus.PROCESSING);
    });

    it("returns count 0 for empty filter with no matches", async () => {
      const collectionName = uniqueCollectionName("bulk_cancel_empty");
      monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const result = await monque.cancelJobs({
        name: "non-existent-queue",
      });
      expect({
        resultCount: result.count,
        resultErrors: result.errors.length,
      }).toStrictEqual({
        resultCount: 0,
        resultErrors: 0,
      });
    });

    it("cancels jobs matching status array", async () => {
      const collectionName = uniqueCollectionName("bulk_cancel_array");
      monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      await monque.enqueue(queueName, { task: 1 });
      await monque.enqueue(queueName, { task: 2 });
      const result = await monque.cancelJobs({
        status: [JobStatus.PENDING],
      });
      expect({
        resultCount: result.count,
        resultErrors: result.errors.length,
      }).toStrictEqual({
        resultCount: 2,
        resultErrors: 0,
      });
    });

    it("emits jobs:cancelled event with count", async () => {
      const collectionName = uniqueCollectionName("bulk_cancel_event");
      monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      await monque.enqueue(queueName, { task: 1 });
      await monque.enqueue(queueName, { task: 2 });
      let emittedPayload:
        | {
            count: number;
          }
        | undefined;
      monque.on("jobs:cancelled", (payload) => {
        emittedPayload = payload;
      });
      await monque.cancelJobs({ name: queueName });
      expect(emittedPayload).toBeDefined();
      expect(emittedPayload?.count).toBe(2);
    });
  });
  describe("retryJobs", () => {
    it("retries all failed jobs matching filter", async () => {
      const collectionName = uniqueCollectionName("bulk_retry_failed");
      monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      // Create failed jobs directly in DB
      const failedDocs = [
        JobFactoryHelpers.failed({ name: queueName, data: { task: 1 } }),
        JobFactoryHelpers.failed({ name: queueName, data: { task: 2 } }),
        JobFactoryHelpers.failed({ name: queueName, data: { task: 3 } }),
      ];
      await db.collection<Job>(collectionName).insertMany(failedDocs);
      const result = await monque.retryJobs({
        status: JobStatus.FAILED,
      });
      expect({
        resultCount: result.count,
        resultErrors: result.errors.length,
      }).toStrictEqual({
        resultCount: 3,
        resultErrors: 0,
      });
      // Verify in DB all are now pending
      const retriedDocs = await db.collection<Job>(collectionName).find({}).toArray();
      const retried = requireValue(retriedDocs);
      expect({
        retriedEveryJobJobStatusJobStatusPENDING: retried.every(
          (job) => job.status === JobStatus.PENDING,
        ),
        retriedEveryJobJobFailCount0: retried.every((job) => job.failCount === 0),
      }).toStrictEqual({
        retriedEveryJobJobStatusJobStatusPENDING: true,
        retriedEveryJobJobFailCount0: true,
      });
    });

    it("retries cancelled jobs as well", async () => {
      const collectionName = uniqueCollectionName("bulk_retry_cancelled");
      monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      // Create and cancel jobs
      await monque.enqueue(queueName, { task: 1 });
      await monque.enqueue(queueName, { task: 2 });
      await monque.cancelJobs({ name: queueName });
      const result = await monque.retryJobs({
        status: JobStatus.CANCELLED,
      });
      expect({
        resultCount: result.count,
        resultErrors: result.errors.length,
      }).toStrictEqual({
        resultCount: 2,
        resultErrors: 0,
      });
    });

    it("only retries failed/cancelled jobs, ignoring pending", async () => {
      const collectionName = uniqueCollectionName("bulk_retry_skip");
      monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      // Create pending job
      await monque.enqueue(queueName, { task: 1 });
      // Create a failed job
      const failedDoc = JobFactoryHelpers.failed({ name: queueName, data: { task: 2 } });
      await db.collection<Job>(collectionName).insertOne(failedDoc);
      // Try to retry by name (includes both pending and failed)
      const result = await monque.retryJobs({
        name: queueName,
      });
      // Only the failed job should be retried; pending silently skipped by status guard
      expect({
        resultCount: result.count,
        resultErrors: result.errors.length,
      }).toStrictEqual({
        resultCount: 1,
        resultErrors: 0,
      });
      // Verify the pending job was not changed
      const pendingJob = await db
        .collection<Job>(collectionName)
        .findOne({ name: queueName, "data.task": 1 });
      expect(pendingJob).toBeDefined();
      expect(pendingJob?.status).toBe(JobStatus.PENDING);
    });

    it("emits jobs:retried event with count", async () => {
      const collectionName = uniqueCollectionName("bulk_retry_event");
      monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const failedDocs = [
        JobFactoryHelpers.failed({ name: queueName, data: { task: 1 } }),
        JobFactoryHelpers.failed({ name: queueName, data: { task: 2 } }),
      ];
      await db.collection<Job>(collectionName).insertMany(failedDocs);
      let emittedPayload:
        | {
            count: number;
          }
        | undefined;
      monque.on("jobs:retried", (payload) => {
        emittedPayload = payload;
      });
      await monque.retryJobs({ status: JobStatus.FAILED });
      expect(emittedPayload).toBeDefined();
      expect(emittedPayload?.count).toBe(2);
    });
  });
  describe("deleteJobs", () => {
    it("deletes jobs matching status and olderThan", async () => {
      const collectionName = uniqueCollectionName("bulk_delete_older");
      monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      // Create completed jobs with old createdAt
      // 7 days ago
      const oldDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const oldDocs = [
        JobFactoryHelpers.completed({ name: queueName, data: { task: 1 }, createdAt: oldDate }),
        JobFactoryHelpers.completed({ name: queueName, data: { task: 2 }, createdAt: oldDate }),
      ];
      await db.collection<Job>(collectionName).insertMany(oldDocs);
      // Create a recent completed job that should NOT be deleted
      const recentDoc = JobFactoryHelpers.completed({
        name: queueName,
        data: { task: 3 },
        createdAt: new Date(),
      });
      await db.collection<Job>(collectionName).insertOne(recentDoc);
      const result = await monque.deleteJobs({
        status: JobStatus.COMPLETED,
        // 1 day ago
        olderThan: new Date(Date.now() - 24 * 60 * 60 * 1000),
      });
      expect({
        resultCount: result.count,
        resultErrors: result.errors.length,
      }).toStrictEqual({
        resultCount: 2,
        resultErrors: 0,
      });
      // Verify only the recent job remains
      const remaining = await db.collection<Job>(collectionName).countDocuments();
      expect(remaining).toBe(1);
    });

    it("deletes jobs newer than specified date", async () => {
      const collectionName = uniqueCollectionName("bulk_delete_newer");
      monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      // Create an old completed job
      const oldDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const oldDoc = JobFactoryHelpers.completed({
        name: queueName,
        data: { task: 1 },
        createdAt: oldDate,
      });
      await db.collection<Job>(collectionName).insertOne(oldDoc);
      // Create recent completed jobs
      const recentDocs = [
        JobFactoryHelpers.completed({ name: queueName, data: { task: 2 } }),
        JobFactoryHelpers.completed({ name: queueName, data: { task: 3 } }),
      ];
      await db.collection<Job>(collectionName).insertMany(recentDocs);
      const result = await monque.deleteJobs({
        status: JobStatus.COMPLETED,
        // 1 day ago
        newerThan: new Date(Date.now() - 24 * 60 * 60 * 1000),
      });
      expect({
        resultCount: result.count,
        resultErrors: result.errors.length,
      }).toStrictEqual({
        resultCount: 2,
        resultErrors: 0,
      });
      // Verify only the old job remains
      const remaining = await db.collection<Job>(collectionName).countDocuments();
      expect(remaining).toBe(1);
    });

    it("returns count 0 when no jobs match", async () => {
      const collectionName = uniqueCollectionName("bulk_delete_empty");
      monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const result = await monque.deleteJobs({
        name: "non-existent-queue",
      });
      expect({
        resultCount: result.count,
        resultErrors: result.errors.length,
      }).toStrictEqual({
        resultCount: 0,
        resultErrors: 0,
      });
    });

    it("can delete jobs in any status", async () => {
      const collectionName = uniqueCollectionName("bulk_delete_any");
      monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      // Create jobs in various statuses
      // pending
      await monque.enqueue(queueName, { task: 1 });
      const failedDoc = JobFactoryHelpers.failed({ name: queueName, data: { task: 2 } });
      await db.collection<Job>(collectionName).insertOne(failedDoc);
      const completedDoc = JobFactoryHelpers.completed({ name: queueName, data: { task: 3 } });
      await db.collection<Job>(collectionName).insertOne(completedDoc);
      const result = await monque.deleteJobs({
        name: queueName,
      });
      expect({
        resultCount: result.count,
        resultErrors: result.errors.length,
      }).toStrictEqual({
        resultCount: 3,
        resultErrors: 0,
      });
      const remaining = await db.collection<Job>(collectionName).countDocuments();
      expect(remaining).toBe(0);
    });

    it("emits jobs:deleted event with count", async () => {
      const collectionName = uniqueCollectionName("bulk_delete_event");
      monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      await monque.enqueue(queueName, { task: 1 });
      await monque.enqueue(queueName, { task: 2 });
      let emittedPayload:
        | {
            count: number;
          }
        | undefined;
      monque.on("jobs:deleted", (payload) => {
        emittedPayload = payload;
      });
      await monque.deleteJobs({ name: queueName });
      expect(emittedPayload).toBeDefined();
      expect(emittedPayload?.count).toBe(2);
    });
  });
});
