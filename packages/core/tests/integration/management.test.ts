import type { Db } from "mongodb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";

import { JobStatus } from "@/jobs";
import type { Job } from "@/jobs";
import { Monque } from "@/scheduler";
import { JobStateError } from "@/shared";
import {
  cleanupTestDb,
  getTestDb,
  stopMonqueInstances,
  uniqueCollectionName,
} from "@test-utils/test-utils";
import { JobFactoryHelpers } from "@tests/factories/job.factory";

import { requireValue } from "./helpers";

describe("Management APIs: Single Job", () => {
  let db: Db;
  let monque: Monque;
  const monqueInstances: Monque[] = [];
  const queueName = "management-test-queue";
  beforeAll(async () => {
    db = await getTestDb("management-api");
  });

  afterEach(async () => {
    await stopMonqueInstances(monqueInstances);
  });

  afterAll(async () => {
    await cleanupTestDb(db);
  });
  describe("cancelJob", () => {
    it("cancels a pending job", async () => {
      const collectionName = uniqueCollectionName("cancel_jobs");
      monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const job = await monque.enqueue(queueName, { task: 1 });
      const cancelled = await monque.cancelJob(job._id.toString());
      expect(cancelled).not.toBeNull();
      expect(cancelled?.status).toBe(JobStatus.CANCELLED);
      expect(cancelled?._id.toString()).toBe(job._id.toString());
      // Verify in DB
      const storedDoc = await db.collection<Job>(collectionName).findOne({ _id: job._id });
      const stored = requireValue(storedDoc);
      expect(stored?.status).toBe(JobStatus.CANCELLED);
    });

    it("cannot cancel a processing job", async () => {
      const collectionName = uniqueCollectionName("cancel_processing");
      monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const jobDoc = JobFactoryHelpers.processing({
        name: queueName,
        data: {},
      });
      const { insertedId } = await db.collection<Job>(collectionName).insertOne(jobDoc);
      const jobId = insertedId.toString();
      await expect(monque.cancelJob(jobId)).rejects.toThrow(JobStateError);
      // Verify status didn't change
      const storedDoc = await db.collection<Job>(collectionName).findOne({ _id: insertedId });
      const stored = requireValue(storedDoc);
      expect(stored?.status).toBe(JobStatus.PROCESSING);
    });

    it("cancel is idempotent for already cancelled jobs", async () => {
      const collectionName = uniqueCollectionName("cancel_idempotent");
      monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const job = await monque.enqueue(queueName, { task: 2 });
      await monque.cancelJob(job._id.toString());
      // Cancel again
      const result = await monque.cancelJob(job._id.toString());
      expect(result?.status).toBe(JobStatus.CANCELLED);
    });

    it("returns null for non-existent job", async () => {
      const collectionName = uniqueCollectionName("cancel_missing");
      monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const fakeId = "000000000000000000000000";
      const result = await monque.cancelJob(fakeId);
      expect(result).toBeNull();
    });
  });
  describe("retryJob", () => {
    it("retries a failed job", async () => {
      const collectionName = uniqueCollectionName("retry_failed");
      monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const jobDoc = JobFactoryHelpers.failed({
        name: queueName,
        data: {},
        failCount: 5,
        failReason: "Something went wrong",
      });
      const { insertedId } = await db.collection<Job>(collectionName).insertOne(jobDoc);
      const jobId = insertedId.toString();
      const result = await monque.retryJob(jobId);
      expect(result).not.toBeNull();
      expect({
        resultStatus: result?.status,
        resultFailCount: result?.failCount,
        resultFailReason: result?.failReason,
      }).toStrictEqual({
        resultStatus: JobStatus.PENDING,
        resultFailCount: 0,
        resultFailReason: undefined,
      });
      // Verify nextRunAt is now/soon (not far future)
      expect(result?.nextRunAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    });

    it("retries a cancelled job", async () => {
      const collectionName = uniqueCollectionName("retry_cancelled");
      monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const job = await monque.enqueue(queueName, { task: 3 });
      await monque.cancelJob(job._id.toString());
      const result = await monque.retryJob(job._id.toString());
      expect(result?.status).toBe(JobStatus.PENDING);
    });

    it("cannot retry a pending job", async () => {
      const collectionName = uniqueCollectionName("retry_pending");
      monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const job = await monque.enqueue(queueName, { task: 4 });
      await expect(monque.retryJob(job._id.toString())).rejects.toThrow(JobStateError);
    });

    it("cannot retry a processing job", async () => {
      const collectionName = uniqueCollectionName("retry_processing");
      monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const jobDoc = JobFactoryHelpers.processing({
        name: queueName,
        data: {},
      });
      const { insertedId } = await db.collection<Job>(collectionName).insertOne(jobDoc);
      await expect(monque.retryJob(insertedId.toString())).rejects.toThrow(JobStateError);
    });
  });
  describe("rescheduleJob", () => {
    it("updates runAt for pending job", async () => {
      const collectionName = uniqueCollectionName("reschedule_pending");
      monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const job = await monque.enqueue(queueName, { task: 5 });
      // 1 hour later
      const futureDate = new Date(Date.now() + 3_600_000);
      const result = await monque.rescheduleJob(job._id.toString(), futureDate);
      expect(result?.nextRunAt.toISOString()).toBe(futureDate.toISOString());
      expect(result?.status).toBe(JobStatus.PENDING);
    });

    it("cannot reschedule a processing job", async () => {
      const collectionName = uniqueCollectionName("reschedule_processing");
      monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const jobDoc = JobFactoryHelpers.processing({
        name: queueName,
        data: {},
      });
      const { insertedId } = await db.collection<Job>(collectionName).insertOne(jobDoc);
      await expect(monque.rescheduleJob(insertedId.toString(), new Date())).rejects.toThrow(
        JobStateError,
      );
    });
  });
  describe("deleteJob", () => {
    it("deletes a job", async () => {
      const collectionName = uniqueCollectionName("delete_job");
      monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const job = await monque.enqueue(queueName, { task: 6 });
      const result = await monque.deleteJob(job._id.toString());
      expect(result).toBe(true);
      const stored = await db.collection<Job>(collectionName).findOne({ _id: job._id });
      expect(stored).toBeNull();
    });

    it("returns false for non-existent job", async () => {
      const collectionName = uniqueCollectionName("delete_missing");
      monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const fakeId = "000000000000000000000000";
      const result = await monque.deleteJob(fakeId);
      expect(result).toBe(false);
    });

    it("can delete a failed job", async () => {
      const collectionName = uniqueCollectionName("delete_failed");
      monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const jobDoc = JobFactoryHelpers.failed({
        name: queueName,
        data: {},
      });
      const { insertedId } = await db.collection<Job>(collectionName).insertOne(jobDoc);
      const result = await monque.deleteJob(insertedId.toString());
      expect(result).toBe(true);
    });
  });
});
