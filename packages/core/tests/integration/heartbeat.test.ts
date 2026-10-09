/**
 * Tests for heartbeat mechanism during job processing.
 *
 * These tests verify:
 * - lastHeartbeat is updated periodically while processing
 * - Heartbeat interval is configurable
 * - Stale jobs are detected using lastHeartbeat
 * - Heartbeat mechanism stops on job completion/failure
 * - Heartbeat cleanup occurs on scheduler shutdown
 */
import type { Db } from "mongodb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";

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
import { JobFactoryHelpers } from "@tests/factories/job.factory.js";

import { forEachSequential } from "./helpers";

describe("heartbeat mechanism", () => {
  let db: Db;
  let collectionName: string;
  const monqueInstances: Monque[] = [];
  beforeAll(async () => {
    db = await getTestDb("heartbeat");
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
  describe("heartbeat updates during processing", () => {
    it("should set lastHeartbeat when claiming a job", async () => {
      const release: PromiseWithResolvers<void> = Promise.withResolvers();
      try {
        collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
        const monque = new Monque(db, {
          collectionName,
          pollInterval: 100,
          heartbeatInterval: 100,
        });
        monqueInstances.push(monque);
        await monque.initialize();
        let jobStarted = false;
        monque.register(TEST_CONSTANTS.JOB_NAME, async () => {
          jobStarted = true;
          await release.promise;
        });
        await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { value: 1 });
        monque.start();
        await waitFor(() => jobStarted, { timeout: 5000 });
        const collection = db.collection<Job>(collectionName);
        const doc = await collection.findOne({ name: TEST_CONSTANTS.JOB_NAME });
        expect(doc?.lastHeartbeat).toBeInstanceOf(Date);
        expect(doc?.heartbeatInterval).toBe(100);
      } finally {
        release.resolve();
      }
    });

    it("should update lastHeartbeat periodically while processing", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      // 100ms for faster test
      const heartbeatInterval = 100;
      const monque = new Monque(db, {
        collectionName,
        pollInterval: 50,
        heartbeatInterval,
      });
      monqueInstances.push(monque);
      await monque.initialize();
      const started: PromiseWithResolvers<void> = Promise.withResolvers();
      const release: PromiseWithResolvers<void> = Promise.withResolvers();
      monque.register(TEST_CONSTANTS.JOB_NAME, async () => {
        started.resolve();
        await release.promise;
      });
      try {
        const job = await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { value: 1 });
        monque.start();
        await started.promise;
        const collection = db.collection<Job>(collectionName);
        const initial = await collection.findOne({ _id: job._id });
        const heartbeat = initial?.lastHeartbeat;
        expect(heartbeat).toBeInstanceOf(Date);
        if (!(heartbeat instanceof Date)) {
          throw new Error("Missing initial heartbeat");
        }
        let previous = heartbeat.getTime();
        const heartbeatAdvanced = async () => {
          const doc = await collection.findOne({ _id: job._id });
          const current = doc?.lastHeartbeat;
          if (!(current instanceof Date) || current.getTime() <= previous) {
            return false;
          }
          previous = current.getTime();
          return true;
        };
        await forEachSequential(
          Array.from({ length: Math.ceil(2 / 1) }, (_, index) => index * 1),
          async (_update) => {
            await waitFor(heartbeatAdvanced, { timeout: 5000, interval: 20 });
          },
        );
      } finally {
        release.resolve();
      }
    });

    it("should clear lastHeartbeat when job completes", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, {
        collectionName,
        pollInterval: 100,
        heartbeatInterval: 50,
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
        docLastHeartbeat: doc?.lastHeartbeat,
        docClaimedBy: doc?.claimedBy,
      }).toStrictEqual({
        docStatus: JobStatus.COMPLETED,
        docLastHeartbeat: undefined,
        docClaimedBy: undefined,
      });
    });
  });
  describe("heartbeat interval configuration", () => {
    it("should use custom heartbeat interval", async () => {
      const release: PromiseWithResolvers<void> = Promise.withResolvers();
      try {
        collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
        const customInterval = 200;
        const monque = new Monque(db, {
          collectionName,
          pollInterval: 50,
          heartbeatInterval: customInterval,
        });
        monqueInstances.push(monque);
        await monque.initialize();
        let jobStarted = false;
        monque.register(TEST_CONSTANTS.JOB_NAME, async () => {
          jobStarted = true;
          await release.promise;
        });
        await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { value: 1 });
        monque.start();
        await waitFor(() => jobStarted, { timeout: 5000 });
        const collection = db.collection<Job>(collectionName);
        const doc = await collection.findOne({ name: TEST_CONSTANTS.JOB_NAME });
        expect(doc?.heartbeatInterval).toBe(customInterval);
      } finally {
        release.resolve();
      }
    });

    it("should use default heartbeat interval of 30000ms", async () => {
      const release: PromiseWithResolvers<void> = Promise.withResolvers();
      try {
        collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
        const monque = new Monque(db, {
          collectionName,
          pollInterval: 50,
          // No heartbeatInterval specified
        });
        monqueInstances.push(monque);
        await monque.initialize();
        let jobStarted = false;
        monque.register(TEST_CONSTANTS.JOB_NAME, async () => {
          jobStarted = true;
          await release.promise;
        });
        await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { value: 1 });
        monque.start();
        await waitFor(() => jobStarted, { timeout: 5000 });
        const collection = db.collection<Job>(collectionName);
        const doc = await collection.findOne({ name: TEST_CONSTANTS.JOB_NAME });
        expect(doc?.heartbeatInterval).toBe(30_000);
      } finally {
        release.resolve();
      }
    });
  });
  describe("stale job detection using lastHeartbeat", () => {
    it("should recover jobs with stale lastHeartbeat on startup", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      // 500ms for faster test
      const lockTimeout = 500;
      // Create a stale job (lastHeartbeat older than lockTimeout)
      const collection = db.collection<Job>(collectionName);
      const staleTime = new Date(Date.now() - lockTimeout * 2);
      const staleJob = JobFactoryHelpers.processing({
        name: TEST_CONSTANTS.JOB_NAME,
        data: { value: "stale" },
        nextRunAt: new Date(Date.now() - 10_000),
        claimedBy: "dead-instance",
        lockedAt: staleTime,
        lastHeartbeat: staleTime,
        heartbeatInterval: 100,
        createdAt: staleTime,
        updatedAt: staleTime,
      });
      await collection.insertOne(staleJob);
      const monque = new Monque(db, {
        collectionName,
        pollInterval: 100,
        lockTimeout,
        recoverStaleJobs: true,
      });
      monqueInstances.push(monque);
      let staleRecovered = false;
      monque.on("stale:recovered", ({ count }) => {
        if (count > 0) {
          staleRecovered = true;
        }
      });
      await monque.initialize();
      // Job should be recovered to pending
      const doc = await collection.findOne({ name: TEST_CONSTANTS.JOB_NAME });
      expect({
        docStatus: doc?.status,
        docClaimedBy: doc?.claimedBy,
        staleRecovered,
      }).toStrictEqual({
        docStatus: JobStatus.PENDING,
        docClaimedBy: undefined,
        staleRecovered: true,
      });
    });

    it("should not recover jobs with recent lastHeartbeat", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const lockTimeout = 5000;
      // Create a job with recent heartbeat (not stale)
      const collection = db.collection<Job>(collectionName);
      const recentTime = new Date();
      const activeJob = JobFactoryHelpers.processing({
        name: TEST_CONSTANTS.JOB_NAME,
        data: { value: "active" },
        nextRunAt: new Date(Date.now() - 10_000),
        claimedBy: "active-instance",
        lockedAt: recentTime,
        lastHeartbeat: recentTime,
        heartbeatInterval: 100,
        createdAt: recentTime,
        updatedAt: recentTime,
      });
      await collection.insertOne(activeJob);
      const monque = new Monque(db, {
        collectionName,
        pollInterval: 100,
        lockTimeout,
        recoverStaleJobs: true,
      });
      monqueInstances.push(monque);
      await monque.initialize();
      // Job should still be processing (not recovered)
      const doc = await collection.findOne({ name: TEST_CONSTANTS.JOB_NAME });
      expect({
        docStatus: doc?.status,
        docClaimedBy: doc?.claimedBy,
      }).toStrictEqual({
        docStatus: JobStatus.PROCESSING,
        docClaimedBy: "active-instance",
      });
    });
  });
  describe("heartbeat cleanup on shutdown", () => {
    it("should release claimed jobs when stop() is called", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const instanceId = "shutdown-instance";
      const monque = new Monque(db, {
        collectionName,
        pollInterval: 50,
        heartbeatInterval: 50,
        schedulerInstanceId: instanceId,
        shutdownTimeout: 5000,
      });
      monqueInstances.push(monque);
      await monque.initialize();
      let jobStarted = false;
      const jobPromiseResult: PromiseWithResolvers<void> = Promise.withResolvers();
      const resolveJob = jobPromiseResult.resolve;
      const jobPromise = jobPromiseResult.promise;
      monque.register(TEST_CONSTANTS.JOB_NAME, async () => {
        jobStarted = true;
        // Wait until we signal completion
        await jobPromise;
      });
      await monque.enqueue(TEST_CONSTANTS.JOB_NAME, { value: 1 });
      monque.start();
      await waitFor(() => jobStarted, { timeout: 5000 });
      // Job is now processing - verify it's claimed
      const collection = db.collection<Job>(collectionName);
      let doc = await collection.findOne({ name: TEST_CONSTANTS.JOB_NAME });
      expect(doc?.claimedBy).toBe(instanceId);
      // Let the job complete
      resolveJob?.();
      // Stop should wait for job to complete
      await monque.stop();
      // After stop, job should be completed and claim cleared
      doc = await collection.findOne({ name: TEST_CONSTANTS.JOB_NAME });
      expect({
        docStatus: doc?.status,
        docClaimedBy: doc?.claimedBy,
      }).toStrictEqual({
        docStatus: JobStatus.COMPLETED,
        docClaimedBy: undefined,
      });
    });
  });
});
