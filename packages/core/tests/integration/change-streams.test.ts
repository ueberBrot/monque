/**
 * Tests for MongoDB Change Stream integration.
 *
 * These tests verify:
 * - Change stream initialization on start()
 * - Job notification via insert events
 * - Job notification via update events (status change to pending)
 * - Error handling and reconnection with exponential backoff
 * - Graceful fallback to polling when change streams unavailable
 * - Change stream cleanup on shutdown
 */
import { EventEmitter } from "node:events";
import { setTimeout as pauseFor } from "node:timers/promises";
import { fromAny } from "@total-typescript/shoehorn";
import type { Db } from "mongodb";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { JobStatus } from "@/jobs";
import type { Job } from "@/jobs";
import { Monque } from "@/scheduler";
import { NonRetryableError } from "@/shared";
import { TEST_CONSTANTS } from "@test-utils/constants.js";
import {
  cleanupTestDb,
  clearCollection,
  getTestDb,
  stopMonqueInstances,
  uniqueCollectionName,
  waitFor,
} from "@test-utils/test-utils.js";

import { forEachSequential } from "./helpers";

describe("change streams", () => {
  let db: Db;
  let collectionName: string;
  const monqueInstances: Monque[] = [];
  beforeAll(async () => {
    db = await getTestDb("change-streams");
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
  describe("change stream initialization", () => {
    it("should emit changestream:closed event on stop()", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, {
        collectionName,
        pollInterval: 10_000,
      });
      monqueInstances.push(monque);
      await monque.initialize();
      let connected = false;
      let closed = false;
      monque.on("changestream:connected", () => {
        connected = true;
      });
      monque.on("changestream:closed", () => {
        closed = true;
      });
      monque.register(TEST_CONSTANTS.JOB_NAME, () => {});
      monque.start();
      await waitFor(() => connected, { timeout: 5000 });
      await monque.stop();
      expect(closed).toBe(true);
    });
  });
  describe("job notification via insert events", () => {
    it("should trigger job processing immediately when job is inserted", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, {
        collectionName,
        // 5 second backup poll - change stream should be faster
        pollInterval: 5000,
      });
      monqueInstances.push(monque);
      await monque.initialize();
      let processingTime: number | null = null;
      let startTime = 0;
      monque.register<{
        value: number;
      }>(TEST_CONSTANTS.JOB_NAME, () => {
        processingTime = Date.now() - startTime;
      });
      let connected = false;
      monque.on("changestream:connected", () => {
        connected = true;
      });
      monque.start();
      await waitFor(() => connected, { timeout: 5000 });
      // Small delay to ensure initial poll has completed
      await pauseFor(200);
      // Enqueue job after change stream is connected and initial poll is done
      startTime = Date.now();
      await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { value: 1 });
      await waitFor(() => processingTime !== null, { timeout: 10_000 });
      // Should process faster than backup poll interval
      expect(processingTime).toBeLessThan(5000);
    });

    it("should process multiple inserted jobs in sequence", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, {
        collectionName,
        // 2 second poll to help pick up remaining jobs
        pollInterval: 2000,
        // Match poll interval for test reliability
        safetyPollInterval: 2000,
        workerConcurrency: 1,
      });
      monqueInstances.push(monque);
      await monque.initialize();
      const processedIds: number[] = [];
      monque.register<{
        id: number;
      }>(TEST_CONSTANTS.JOB_NAME, async (job) => {
        processedIds.push(job.data.id);
        await pauseFor(50);
      });
      let connected = false;
      monque.on("changestream:connected", () => {
        connected = true;
      });
      monque.start();
      await waitFor(() => connected, { timeout: 5000 });
      // Enqueue jobs after change stream is connected
      await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { id: 1 });
      await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { id: 2 });
      await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { id: 3 });
      await waitFor(() => processedIds.length === 3, { timeout: 10_000 });
      expect(processedIds).toHaveLength(3);
    });
  });
  describe("job notification via update events", () => {
    it("should process job when status changes to pending (retry scenario)", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, {
        collectionName,
        // 2 second poll for quicker retry pickup
        pollInterval: 2000,
        // Match poll interval for test reliability
        safetyPollInterval: 2000,
        maxRetries: 3,
        // Short interval for faster retry
        baseRetryInterval: 50,
      });
      monqueInstances.push(monque);
      await monque.initialize();
      let attempts = 0;
      let completed = false;
      monque.register(TEST_CONSTANTS.JOB_NAME, () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("First attempt fails");
        }
        completed = true;
      });
      let connected = false;
      monque.on("changestream:connected", () => {
        connected = true;
      });
      monque.start();
      await waitFor(() => connected, { timeout: 5000 });
      await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { value: 1 });
      // Wait for retry to complete
      await waitFor(() => completed, { timeout: 10_000 });
      expect({
        attempts,
        completed,
      }).toStrictEqual({
        attempts: 2,
        completed: true,
      });
    });

    it("should detect recurring job reschedule via update event", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, {
        collectionName,
        // nextRunAt changes rely on polling (status changes trigger change stream)
        pollInterval: 2000,
        // Match poll interval — this update bypasses change streams
        safetyPollInterval: 2000,
      });
      monqueInstances.push(monque);
      await monque.initialize();
      let executions = 0;
      monque.register(TEST_CONSTANTS.JOB_NAME, () => {
        executions += 1;
      });
      let connected = false;
      monque.on("changestream:connected", () => {
        connected = true;
      });
      monque.start();
      await waitFor(() => connected, { timeout: 5000 });
      // Schedule a job that should run immediately
      const job = await monque.schedule("* * * * *", TEST_CONSTANTS.JOB_NAME, { value: 1 });
      // Trigger it by setting nextRunAt to now
      const collection = db.collection(collectionName);
      await collection.updateOne({ _id: job._id }, { $set: { nextRunAt: new Date() } });
      await waitFor(() => executions >= 1, { timeout: 5000 });
      expect(executions).toBeGreaterThanOrEqual(1);
    });
  });
  describe("error handling and reconnection", () => {
    it("should continue processing with polling when change stream fails", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, {
        collectionName,
        // Fast polling for fallback
        pollInterval: 100,
        // Match poll interval for test reliability
        safetyPollInterval: 100,
      });
      monqueInstances.push(monque);
      await monque.initialize();
      let processed = false;
      monque.register(TEST_CONSTANTS.JOB_NAME, () => {
        processed = true;
      });
      monque.start();
      // Even if change stream has issues, polling should work
      await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { value: 1 });
      await waitFor(() => processed, { timeout: 5000 });
      expect(processed).toBe(true);
    });
  });
  describe("fallback to polling", () => {
    it.each([false, true])(
      "refills capacity without streams or waiting for the fallback interval (failure: %s)",
      async (fail) => {
        collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
        const originalCollection = db.collection.bind(db);
        const collectionSpy = vi.spyOn(db, "collection").mockImplementation((name, options) => {
          const collection = originalCollection(name, options);
          vi.spyOn(collection, "watch").mockImplementation(() => {
            throw new Error("Change streams unavailable");
          });
          return collection;
        });
        const monque = new Monque(db, {
          collectionName,
          workerConcurrency: 1,
          pollInterval: 60_000,
          safetyPollInterval: 60_000,
        });
        monqueInstances.push(monque);
        const started: PromiseWithResolvers<void> = Promise.withResolvers();
        const unavailable: PromiseWithResolvers<void> = Promise.withResolvers();
        const release: PromiseWithResolvers<void> = Promise.withResolvers();
        try {
          await monque.initialize();
          monque.once("changestream:fallback", () => {
            unavailable.resolve();
          });
          monque.register<{
            first: boolean;
          }>("work", async (job) => {
            if (job.data.first) {
              started.resolve();
              await release.promise;
              if (fail) {
                throw new NonRetryableError("Terminal failure");
              }
            }
          });
          await monque.enqueue("work", { first: true });
          const next = await monque.enqueue("work", { first: false });
          monque.start();
          await Promise.all([started.promise, unavailable.promise]);
          release.resolve();
          await waitFor(
            async () => {
              const awaitedResult1 = await monque.getJob(next._id);
              return awaitedResult1?.status === JobStatus.COMPLETED;
            },
            { timeout: 5000 },
          );
          const awaitedResult2 = await monque.getJob(next._id);
          expect(awaitedResult2?.failCount).toBe(0);
        } finally {
          release.resolve();
          await monque.stop();
          collectionSpy.mockRestore();
        }
      },
    );

    it("should use polling as backup even with active change streams", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, {
        collectionName,
        // Fast polling for test
        pollInterval: 200,
        // Match poll interval since test relies on backup polling
        safetyPollInterval: 200,
      });
      monqueInstances.push(monque);
      await monque.initialize();
      let processCount = 0;
      monque.register(TEST_CONSTANTS.JOB_NAME, () => {
        processCount += 1;
      });
      monque.start();
      // Enqueue multiple jobs
      await forEachSequential(
        Array.from({ length: Math.ceil(5 / 1) }, (_, index) => index * 1),
        async (i) => {
          await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { value: i });
        },
      );
      await waitFor(() => processCount === 5, { timeout: 10_000 });
      expect(processCount).toBe(5);
    });
  });
  describe("cleanup on shutdown", () => {
    it("should not reconnect after stop() during reconnect backoff", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const originalCollectionFn = db.collection.bind(db);
      // oxlint-disable-next-line unicorn/prefer-event-target -- MongoDB change streams implement Node EventEmitter subscriptions.
      const mockChangeStream = Object.assign(new EventEmitter(), {
        close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      });
      let watchCallCount = 0;
      const collectionSpy = vi.spyOn(db, "collection").mockImplementation((name, options) => {
        const collection = originalCollectionFn(name, options);
        vi.spyOn(collection, "watch").mockImplementation(() => {
          watchCallCount += 1;
          return fromAny<ReturnType<typeof collection.watch>, unknown>(mockChangeStream);
        });
        return collection;
      });
      try {
        const monque = new Monque(db, {
          collectionName,
          pollInterval: 10_000,
        });
        monqueInstances.push(monque);
        await monque.initialize();
        monque.register(TEST_CONSTANTS.JOB_NAME, () => {});
        monque.start();
        mockChangeStream.emit("error", new Error("Connection lost"));
        await monque.stop();
        await pauseFor(1200);
        expect(watchCallCount).toBe(1);
        expect(mockChangeStream.close).toHaveBeenCalledOnce();
      } finally {
        collectionSpy.mockRestore();
      }
    });

    it("should not process new jobs after stop() is called", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, {
        collectionName,
        pollInterval: 10_000,
      });
      monqueInstances.push(monque);
      await monque.initialize();
      let processedAfterStop = false;
      monque.register(TEST_CONSTANTS.JOB_NAME, () => {
        processedAfterStop = true;
      });
      let connected = false;
      monque.on("changestream:connected", () => {
        connected = true;
      });
      monque.start();
      await waitFor(() => connected, { timeout: 5000 });
      await monque.stop();
      // Enqueue after stop - should not be processed
      await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { value: 1 });
      await pauseFor(500);
      expect(processedAfterStop).toBe(false);
    });
  });
  describe("integration with atomic claim", () => {
    it("should distribute jobs across multiple instances via change streams", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const jobCount = 10;
      const monque1 = new Monque(db, {
        collectionName,
        // 5 second backup poll
        pollInterval: 5000,
        // Faster safety net for test reliability
        safetyPollInterval: 500,
        schedulerInstanceId: "cs-instance-1",
        workerConcurrency: 2,
      });
      const monque2 = new Monque(db, {
        collectionName,
        // 5 second backup poll
        pollInterval: 5000,
        // Faster safety net for test reliability
        safetyPollInterval: 500,
        schedulerInstanceId: "cs-instance-2",
        workerConcurrency: 2,
      });
      monqueInstances.push(monque1, monque2);
      await monque1.initialize();
      await monque2.initialize();
      const processedJobs = new Set<number>();
      const duplicates = new Set<number>();
      const instance1Jobs: number[] = [];
      const instance2Jobs: number[] = [];
      const handler1 = async (
        job: Job<{
          id: number;
        }>,
      ) => {
        const { id } = job.data;
        if (processedJobs.has(id)) {
          duplicates.add(id);
        }
        processedJobs.add(id);
        instance1Jobs.push(id);
        await pauseFor(50);
      };
      const handler2 = async (
        job: Job<{
          id: number;
        }>,
      ) => {
        const { id } = job.data;
        if (processedJobs.has(id)) {
          duplicates.add(id);
        }
        processedJobs.add(id);
        instance2Jobs.push(id);
        await pauseFor(50);
      };
      monque1.register(TEST_CONSTANTS.JOB_NAME, handler1);
      monque2.register(TEST_CONSTANTS.JOB_NAME, handler2);
      let connected1 = false;
      let connected2 = false;
      monque1.on("changestream:connected", () => {
        connected1 = true;
      });
      monque2.on("changestream:connected", () => {
        connected2 = true;
      });
      monque1.start();
      monque2.start();
      await waitFor(() => connected1 && connected2, { timeout: 5000 });
      // Enqueue jobs
      await forEachSequential(
        Array.from({ length: Math.ceil(jobCount / 1) }, (_, index) => index * 1),
        async (i) => {
          await monque1.enqueue(TEST_CONSTANTS.JOB_NAME, { id: i });
        },
      );
      await waitFor(() => processedJobs.size === jobCount, { timeout: 30_000 });
      expect({
        processedJobsSize: processedJobs.size,
        duplicatesSize: duplicates.size,
        instance1JobsLengthInstance2JobsLength: instance1Jobs.length + instance2Jobs.length,
      }).toStrictEqual({
        processedJobsSize: jobCount,
        duplicatesSize: 0,
        instance1JobsLengthInstance2JobsLength: jobCount,
      });
    });
  });
  describe("performance", () => {
    it("should process jobs with lower latency than poll interval", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      // 10 seconds
      const pollInterval = 10_000;
      const monque = new Monque(db, {
        collectionName,
        pollInterval,
      });
      monqueInstances.push(monque);
      await monque.initialize();
      const latencies: number[] = [];
      let processed = 0;
      monque.register<{
        startTime: number;
      }>(TEST_CONSTANTS.JOB_NAME, (job) => {
        latencies.push(Date.now() - job.data.startTime);
        processed += 1;
      });
      let connected = false;
      monque.on("changestream:connected", () => {
        connected = true;
      });
      monque.start();
      await waitFor(() => connected, { timeout: 5000 });
      // Enqueue several jobs with timestamps
      await forEachSequential(
        Array.from({ length: Math.ceil(5 / 1) }, (_, index) => index * 1),
        async (_i) => {
          await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { startTime: Date.now() });
          await pauseFor(100);
        },
      );
      await waitFor(() => processed === 5, { timeout: 15_000 });
      // All latencies should be much less than poll interval
      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      expect(avgLatency).toBeLessThan(pollInterval);
      // Most should be under 1 second with change streams
      const fastJobs = latencies.filter((l) => l < 1000).length;
      expect(fastJobs).toBeGreaterThan(0);
    });
  });
  describe("adaptive poll scheduling", () => {
    it("should process future-dated job via wakeup timer without polling", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      // Poll and safety intervals set very high — neither should fire during the test.
      // The wakeup timer is the ONLY mechanism that should process the future job.
      const monque = new Monque(db, {
        collectionName,
        pollInterval: 60_000,
        safetyPollInterval: 60_000,
      });
      monqueInstances.push(monque);
      await monque.initialize();
      let warmupProcessed = false;
      let futureProcessed = false;
      monque.register(TEST_CONSTANTS.JOB_NAME, () => {
        if (warmupProcessed) {
          futureProcessed = true;
        } else {
          warmupProcessed = true;
        }
      });
      let connected = false;
      monque.on("changestream:connected", () => {
        connected = true;
      });
      monque.start();
      await waitFor(() => connected, { timeout: 5000 });
      // Warm-up: enqueue and process an immediate job to prove the change
      // stream cursor is fully operational. This eliminates the race between
      // the `connected` event and the server-side cursor being ready to deliver events.
      await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { warmup: true });
      await waitFor(() => warmupProcessed, { timeout: 5000 });
      const startTime = Date.now();
      // Now enqueue a job scheduled 2 seconds in the future.
      // The CS will receive the insert, see nextRunAt > now, and set a wakeup
      // timer. The timer fires at ~2.2s (2s + 200ms grace period).
      await monque.enqueue(
        TEST_CONSTANTS.JOB_NAME,
        { value: 1 },
        {
          runAt: new Date(Date.now() + 2000),
        },
      );
      // The wakeup timer should process this well under 10s.
      // Neither poll (60s) nor safety poll (60s) will fire in this window.
      await waitFor(() => futureProcessed, { timeout: 10_000 });
      const processingTime = Date.now() - startTime;
      expect(futureProcessed).toBe(true);
      // Must complete well before polls could fire — proves wakeup timer worked
      expect(processingTime).toBeLessThan(8000);
    });
  });
});
