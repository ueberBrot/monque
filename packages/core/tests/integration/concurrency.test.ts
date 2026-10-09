import { setTimeout as pauseFor } from "node:timers/promises";
/**
 * Integration tests for concurrency and race conditions.
 *
 * These tests verify:
 * - SC-006: Multiple scheduler instances can process jobs concurrently without duplicate processing
 * - High volume job processing with multiple workers
 *
 * @see {@link ../../src/scheduler/monque.ts}
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

import { forEachSequential } from "./helpers";

describe("Concurrency & Scalability", () => {
  let db: Db;
  let collectionName: string;
  const monqueInstances: Monque[] = [];
  beforeAll(async () => {
    db = await getTestDb("concurrency");
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

  it("should process 100 jobs with 3 scheduler instances without duplicates", async () => {
    collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
    const jobCount = 100;
    const instanceCount = 3;
    // Create multiple Monque instances sharing the same collection
    await forEachSequential(
      Array.from({ length: Math.ceil(instanceCount / 1) }, (_, index) => index * 1),
      async (_i) => {
        const monque = new Monque(db, {
          collectionName,
          // Fast polling for test
          pollInterval: 50,
          safetyPollInterval: 50,
          workerConcurrency: 5,
        });
        monqueInstances.push(monque);
        await monque.initialize();
      },
    );
    // Track processed jobs
    const processedJobs = new Set<number>();
    const duplicateJobs = new Set<number>();
    const processingErrors: Error[] = [];
    // Define handler that tracks execution
    const handler = async (
      job: Job<{
        id: number;
      }>,
    ) => {
      const { id } = job.data;
      if (processedJobs.has(id)) {
        duplicateJobs.add(id);
      }
      processedJobs.add(id);
      // Simulate some work
      await pauseFor(10);
    };
    // Register worker on all instances
    for (const monque of monqueInstances) {
      monque.register(TEST_CONSTANTS.JOB_NAME, handler);
      monque.on("job:error", (payload) => {
        processingErrors.push(payload.error);
      });
    }
    // Enqueue jobs using the first instance
    const [firstInstance] = monqueInstances;
    if (!firstInstance) {
      throw new Error("No Monque instance available");
    }
    const enqueuePromises = [];
    for (let i = 0; i < jobCount; i += 1) {
      enqueuePromises.push(firstInstance.enqueue(TEST_CONSTANTS.JOB_NAME, { id: i }));
    }
    await Promise.all(enqueuePromises);
    // Start all instances
    for (const m of monqueInstances) {
      m.start();
    }
    // Wait for all jobs to be processed
    await waitFor(() => processedJobs.size === jobCount, {
      timeout: 30_000,
    });
    // Verify results
    expect({
      processedJobsSize: processedJobs.size,
      duplicateJobsSize: duplicateJobs.size,
      processingErrors: processingErrors.length,
    }).toStrictEqual({
      processedJobsSize: jobCount,
      duplicateJobsSize: 0,
      processingErrors: 0,
    });
    // Verify in DB that all are completed
    await waitFor(
      async () => {
        const count = await db
          .collection(collectionName)
          .countDocuments({ status: JobStatus.COMPLETED });
        return count === jobCount;
      },
      { timeout: 10_000 },
    );
    const count = await db
      .collection(collectionName)
      .countDocuments({ status: JobStatus.COMPLETED });
    expect(count).toBe(jobCount);
  });
});
describe("Instance-level Concurrency (instanceConcurrency)", () => {
  let db: Db;
  let collectionName: string;
  const monqueInstances: Monque[] = [];
  beforeAll(async () => {
    db = await getTestDb("max-concurrency");
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

  it("should limit total concurrent jobs to instanceConcurrency", async () => {
    collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
    const instanceConcurrency = 3;
    const stats = {
      active: 0,
      max: 0,
      completed: 0,
      inc() {
        this.active += 1;
        if (this.active > this.max) {
          this.max = this.active;
        }
      },
      dec() {
        this.active -= 1;
        this.completed += 1;
      },
    };
    const monque = new Monque(db, {
      collectionName,
      // Slower polling to avoid race conditions in test
      pollInterval: 500,
      safetyPollInterval: 500,
      // Limit to 3 concurrent jobs total
      instanceConcurrency,
      // Each worker could do 10, but global limit is 3
      workerConcurrency: 10,
    });
    monqueInstances.push(monque);
    await monque.initialize();
    // Handler that tracks concurrent execution
    const handler = async (_job: Job) => {
      stats.inc();
      // Simulate work - longer than poll interval to test proper throttling
      await pauseFor(200);
      stats.dec();
    };
    // Register two workers - each has concurrency 10, but global limit is 3
    monque.register("worker-a", handler);
    monque.register("worker-b", handler);
    // Enqueue 5 jobs for each worker (10 total)
    await forEachSequential(
      Array.from({ length: Math.ceil(5 / 1) }, (_, index) => index * 1),
      async (i) => {
        await monque.enqueue("worker-a", { id: i });
        await monque.enqueue("worker-b", { id: i });
      },
    );
    monque.start();
    // Wait for all jobs to complete
    await waitFor(() => stats.completed >= 10, { timeout: 30_000 });
    // Max concurrent should never exceed instanceConcurrency (3)
    expect(stats.max).toBeLessThanOrEqual(instanceConcurrency);
    expect(stats.completed).toBe(10);
  });

  it("should process all jobs with instanceConcurrency even when limit is lower than worker concurrency", async () => {
    collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
    let completedJobs = 0;
    const monque = new Monque(db, {
      collectionName,
      pollInterval: 50,
      safetyPollInterval: 50,
      instanceConcurrency: 2,
      workerConcurrency: 5,
    });
    monqueInstances.push(monque);
    await monque.initialize();
    const handler = async (_job: Job) => {
      await pauseFor(50);
      completedJobs += 1;
    };
    monque.register("test-job", handler);
    // Enqueue 6 jobs
    await forEachSequential(
      Array.from({ length: Math.ceil(6 / 1) }, (_, index) => index * 1),
      async (i) => {
        await monque.enqueue("test-job", { id: i });
      },
    );
    monque.start();
    // Wait for all jobs to complete
    await waitFor(() => completedJobs >= 6, { timeout: 10_000 });
    expect(completedJobs).toBe(6);
    // Verify all completed in DB
    await waitFor(
      async () => {
        const count = await db
          .collection(collectionName)
          .countDocuments({ status: JobStatus.COMPLETED });
        return count === 6;
      },
      { timeout: 10_000 },
    );
    const count = await db
      .collection(collectionName)
      .countDocuments({ status: JobStatus.COMPLETED });
    expect(count).toBe(6);
  });

  it("should work normally without instanceConcurrency set", async () => {
    collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
    let activeJobs = 0;
    let maxActiveJobs = 0;
    let completedJobs = 0;
    const monque = new Monque(db, {
      collectionName,
      pollInterval: 50,
      safetyPollInterval: 50,
      // No instanceConcurrency set
      workerConcurrency: 5,
    });
    monqueInstances.push(monque);
    await monque.initialize();
    const handler = async (_job: Job) => {
      activeJobs += 1;
      maxActiveJobs = Math.max(maxActiveJobs, activeJobs);
      await pauseFor(50);
      activeJobs -= 1;
      completedJobs += 1;
    };
    monque.register("test-job", handler);
    // Enqueue 10 jobs
    await forEachSequential(
      Array.from({ length: Math.ceil(10 / 1) }, (_, index) => index * 1),
      async (i) => {
        await monque.enqueue("test-job", { id: i });
      },
    );
    monque.start();
    await waitFor(() => completedJobs >= 10, { timeout: 10_000 });
    // Without instanceConcurrency, should be able to run up to workerConcurrency (5)
    expect(maxActiveJobs).toBeLessThanOrEqual(5);
    // Should have some concurrency
    expect(maxActiveJobs).toBeGreaterThan(1);
    expect(completedJobs).toBe(10);
  });
});
