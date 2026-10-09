import { setTimeout as pauseFor } from "node:timers/promises";
/**
 * Tests for job lifecycle events and observability in the Monque scheduler.
 *
 * These tests verify:
 * - job:start event emission
 * - job:complete event emission with duration
 * - job:fail event emission with error and retry status
 * - job:error event emission for unexpected errors
 * - isHealthy() status reporting
 *
 * @see {@link ../../src/scheduler/monque.ts}
 */
import type { Db } from "mongodb";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import type { MonqueEventMap } from "@/events";
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

const completeAfter50Milliseconds = async () => {
  await pauseFor(50);
};

describe("Monitor Job Lifecycle Events", () => {
  let db: Db;
  let collectionName: string;
  let monque: Monque;
  const monqueInstances: Monque[] = [];
  beforeAll(async () => {
    db = await getTestDb("events");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await stopMonqueInstances(monqueInstances);
    if (collectionName) {
      await clearCollection(db, collectionName);
    }
  });

  afterAll(async () => {
    await cleanupTestDb(db);
  });
  describe("job:start event", () => {
    it("should emit job:start when processing begins", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      monque = new Monque(db, { collectionName, pollInterval: 50 });
      monqueInstances.push(monque);
      await monque.initialize();
      const startEvents: Job[] = [];
      monque.on("job:start", (job) => {
        startEvents.push({ ...job });
      });
      const handler = vi.fn<() => void>();
      monque.register(TEST_CONSTANTS.JOB_NAME, handler);
      await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { data: "test" });
      monque.start();
      await waitFor(() => startEvents.length > 0);
      expect({
        startEvents: startEvents.length,
        name: startEvents[0]?.name,
        status: startEvents[0]?.status,
      }).toStrictEqual({
        startEvents: 1,
        name: TEST_CONSTANTS.JOB_NAME,
        status: JobStatus.PROCESSING,
      });
    });
  });
  describe("job:complete event", () => {
    it("should emit job:complete with duration when job finishes successfully", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      monque = new Monque(db, { collectionName, pollInterval: 50 });
      monqueInstances.push(monque);
      await monque.initialize();
      const completeEvents: MonqueEventMap["job:complete"][] = [];
      monque.on("job:complete", (payload) => {
        completeEvents.push(payload);
      });
      const handler = vi.fn<typeof completeAfter50Milliseconds>(completeAfter50Milliseconds);
      monque.register(TEST_CONSTANTS.JOB_NAME, handler);
      await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { data: "test" });
      monque.start();
      await waitFor(() => completeEvents.length > 0);
      expect({
        completeEvents: completeEvents.length,
        name: completeEvents[0]?.job.name,
        status: completeEvents[0]?.job.status,
      }).toStrictEqual({
        completeEvents: 1,
        name: TEST_CONSTANTS.JOB_NAME,
        status: JobStatus.COMPLETED,
      });
      // Allow 5ms tolerance for timer precision
      expect(completeEvents[0]?.duration).toBeGreaterThanOrEqual(45);
    });
  });
  describe("job:fail event", () => {
    it("should emit job:fail with error and willRetry=true when job fails and has retries left", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      monque = new Monque(db, {
        collectionName,
        pollInterval: 50,
        maxRetries: 3,
      });
      monqueInstances.push(monque);
      await monque.initialize();
      const failEvents: MonqueEventMap["job:fail"][] = [];
      monque.on("job:fail", (payload) => {
        failEvents.push(payload);
      });
      const error = new Error("Task failed");
      const handler = vi.fn<() => Promise<void>>().mockRejectedValue(error);
      monque.register(TEST_CONSTANTS.JOB_NAME, handler);
      await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { data: "test" });
      monque.start();
      await waitFor(() => failEvents.length > 0);
      expect({
        failEvents: failEvents.length,
        name: failEvents[0]?.job.name,
        errorMessage: failEvents[0]?.error.message,
        willRetry: failEvents[0]?.willRetry,
      }).toStrictEqual({
        failEvents: 1,
        name: TEST_CONSTANTS.JOB_NAME,
        errorMessage: "Task failed",
        willRetry: true,
      });
    });

    it("should emit job:fail with willRetry=false when job fails and max retries reached", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      monque = new Monque(db, {
        collectionName,
        pollInterval: 50,
        // Only 1 attempt allowed (0 retries)
        maxRetries: 1,
      });
      monqueInstances.push(monque);
      await monque.initialize();
      const failEvents: MonqueEventMap["job:fail"][] = [];
      monque.on("job:fail", (payload) => {
        failEvents.push(payload);
      });
      const handler = vi.fn<() => Promise<void>>().mockRejectedValue(new Error("Final failure"));
      monque.register(TEST_CONSTANTS.JOB_NAME, handler);
      await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { data: "test" });
      monque.start();
      await waitFor(() => failEvents.length > 0);
      expect({
        failEvents: failEvents.length,
        willRetry: failEvents[0]?.willRetry,
      }).toStrictEqual({
        failEvents: 1,
        willRetry: false,
      });
    });
  });
  describe("job:error event", () => {
    it("should emit job:error for unexpected errors", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      monque = new Monque(db, { collectionName, pollInterval: 50 });
      monqueInstances.push(monque);
      // Register a worker so poll() has something to do and reaches the database
      monque.register(TEST_CONSTANTS.JOB_NAME, () => {});
      const errorEvents: MonqueEventMap["job:error"][] = [];
      monque.on("job:error", (payload) => {
        errorEvents.push(payload);
      });
      // Mock findOneAndUpdate to throw an error during polling
      // This avoids mocking private methods and couples the test to the data layer dependency instead
      const collection = db.collection(collectionName);
      vi.spyOn(collection, "findOneAndUpdate").mockRejectedValue(new Error("Poll error"));
      vi.spyOn(db, "collection").mockReturnValue(collection);
      await monque.initialize();
      await monque.enqueue(TEST_CONSTANTS.JOB_NAME, {});
      monque.start();
      await waitFor(() => errorEvents.length > 0);
      expect(errorEvents.length).toBeGreaterThan(0);
      expect(errorEvents[0]?.error.message).toBe("Poll error");
    });
  });
  describe("job:cancelled event", () => {
    it("should emit job:cancelled when a job is cancelled", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const cancelledEvents: MonqueEventMap["job:cancelled"][] = [];
      monque.on("job:cancelled", (payload) => {
        cancelledEvents.push(payload);
      });
      const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { data: "cancel-me" });
      await monque.cancelJob(job._id.toString());
      expect(cancelledEvents).toHaveLength(1);
      const [event] = cancelledEvents;
      if (!event) {
        throw new Error("Event not found");
      }
      expect(event.job._id?.toString()).toBe(job._id.toString());
      expect(event.job.status).toBe(JobStatus.CANCELLED);
    });

    it("should not emit job:cancelled when cancelling an already cancelled job", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const cancelledEvents: MonqueEventMap["job:cancelled"][] = [];
      monque.on("job:cancelled", (payload) => {
        cancelledEvents.push(payload);
      });
      const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { data: "cancel-me-once" });
      await monque.cancelJob(job._id.toString());
      await monque.cancelJob(job._id.toString());
      expect(cancelledEvents).toHaveLength(1);
    });
  });
  describe("job:retried event", () => {
    it("should emit job:retried when a failing job is retried", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const retriedEvents: MonqueEventMap["job:retried"][] = [];
      monque.on("job:retried", (payload) => {
        retriedEvents.push(payload);
      });
      // Manually insert a failed job
      const { insertedId } = await db.collection(collectionName).insertOne({
        name: TEST_CONSTANTS.JOB_NAME,
        data: { foo: "bar" },
        status: JobStatus.FAILED,
        createdAt: new Date(),
        updatedAt: new Date(),
        failCount: 1,
        failReason: "Manual failure",
      });
      await monque.retryJob(insertedId.toString());
      expect(retriedEvents).toHaveLength(1);
      const [event] = retriedEvents;
      if (!event) {
        throw new Error("Event not found");
      }
      expect(event.job._id?.toString()).toBe(insertedId.toString());
      expect(event.previousStatus).toBe(JobStatus.FAILED);
    });
  });
  describe("job:deleted event", () => {
    it("should emit job:deleted when a job is deleted", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const deletedEvents: MonqueEventMap["job:deleted"][] = [];
      monque.on("job:deleted", (payload) => {
        deletedEvents.push(payload);
      });
      const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { data: "delete-me" });
      await monque.deleteJob(job._id.toString());
      expect(deletedEvents).toHaveLength(1);
      const [event] = deletedEvents;
      if (!event) {
        throw new Error("Event not found");
      }
      expect(event.jobId).toBe(job._id.toString());
    });
  });
  describe("isHealthy()", () => {
    it("should return true when running and initialized", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      // Not started yet
      expect(monque.isHealthy()).toBe(false);
      monque.start();
      expect(monque.isHealthy()).toBe(true);
    });

    it("should return false when stopped", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      monque.start();
      await monque.stop();
      expect(monque.isHealthy()).toBe(false);
    });
  });
  describe("event listener methods", () => {
    it("should remove listener with off() method", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      monque = new Monque(db, { collectionName, pollInterval: 50 });
      monqueInstances.push(monque);
      await monque.initialize();
      const startEvents: Job[] = [];
      const listener = (job: Job) => {
        startEvents.push(job);
      };
      // Add listener
      monque.on("job:start", listener);
      // Register worker and enqueue job
      monque.register(TEST_CONSTANTS.JOB_NAME, () => {});
      await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { data: "test1" });
      monque.start();
      await waitFor(() => startEvents.length > 0);
      expect(startEvents).toHaveLength(1);
      // Remove listener
      monque.off("job:start", listener);
      // Enqueue another job
      await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { data: "test2" });
      await waitFor(
        async () => {
          const jobs = await monque.getJobs({ status: JobStatus.COMPLETED });
          return jobs.length >= 2;
        },
        { timeout: 5000 },
      );
      // Listener should not have received the second event
      expect(startEvents).toHaveLength(1);
    });

    it("should fire listener only once with once() method", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      monque = new Monque(db, { collectionName, pollInterval: 50 });
      monqueInstances.push(monque);
      await monque.initialize();
      const completeEvents: MonqueEventMap["job:complete"][] = [];
      monque.once("job:complete", (payload) => {
        completeEvents.push(payload);
      });
      // Register worker and enqueue multiple jobs
      monque.register(TEST_CONSTANTS.JOB_NAME, () => {});
      await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { data: "test1" });
      await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { data: "test2" });
      await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { data: "test3" });
      monque.start();
      // Wait for all jobs to complete
      await waitFor(
        async () => {
          const jobs = await monque.getJobs({ status: JobStatus.COMPLETED });
          return jobs.length >= 3;
        },
        { timeout: 5000 },
      );
      // once() listener should have fired only once
      expect(completeEvents).toHaveLength(1);
    });
  });
});
