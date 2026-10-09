import { setTimeout as pauseFor } from "node:timers/promises";
import type { Db } from "mongodb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";

import type { Job } from "@/jobs";
import { JobStatus } from "@/jobs";
import { Monque } from "@/scheduler";
import { TEST_CONSTANTS } from "@test-utils/constants.js";
import {
  cleanupTestDb,
  getTestDb,
  stopMonqueInstances,
  uniqueCollectionName,
  waitFor,
} from "@test-utils/test-utils.js";
import { JobFactoryHelpers } from "@tests/factories/job.factory.js";

import { forEachSequential } from "./helpers";

describe("job retention", () => {
  let db: Db;
  let collectionName: string;
  const monqueInstances: Monque[] = [];
  beforeAll(async () => {
    db = await getTestDb("retention");
  });

  afterEach(async () => {
    await stopMonqueInstances(monqueInstances);
  });

  afterAll(async () => {
    await cleanupTestDb(db);
  });

  it("should delete completed jobs older than specified retention", async () => {
    collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
    // Configure retention to clean up every 100ms, keeping completed jobs for 5000ms
    const monque = new Monque(db, {
      collectionName,
      pollInterval: 1000,
      jobRetention: {
        // 5000ms retention
        completed: 5000,
        // Check every 100ms
        interval: 100,
      },
    });
    monqueInstances.push(monque);
    const collection = db.collection<Job>(collectionName);
    const now = new Date();
    // 6s ago (should be deleted)
    const oldDate = new Date(now.getTime() - 6000);
    // 100ms ago (should be kept)
    const recentDate = new Date(now.getTime() - 100);
    // Insert old completed job
    await collection.insertOne(
      JobFactoryHelpers.completed({
        name: "old-job",
        updatedAt: oldDate,
      }),
    );
    // Insert recent completed job
    await collection.insertOne(
      JobFactoryHelpers.completed({
        name: "recent-job",
        updatedAt: recentDate,
      }),
    );
    await monque.initialize();
    monque.start();
    // Wait for cleanup to happen
    await waitFor(
      async () => {
        const count = await collection.countDocuments({ name: "old-job" });
        return count === 0;
      },
      { timeout: 2000, interval: 50 },
    );
    const oldJob = await collection.findOne({ name: "old-job" });
    expect(oldJob).toBeNull();
    const recentJob = await collection.findOne({ name: "recent-job" });
    expect(recentJob).not.toBeNull();
  });

  it("should delete failed jobs older than specified retention", async () => {
    collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
    const monque = new Monque(db, {
      collectionName,
      pollInterval: 1000,
      jobRetention: {
        // 5000ms retention
        failed: 5000,
        // Check every 100ms
        interval: 100,
      },
    });
    monqueInstances.push(monque);
    const collection = db.collection<Job>(collectionName);
    const now = new Date();
    const oldDate = new Date(now.getTime() - 6000);
    const recentDate = new Date(now.getTime() - 100);
    await collection.insertOne(
      JobFactoryHelpers.failed({
        name: "old-failed-job",
        updatedAt: oldDate,
      }),
    );
    await collection.insertOne(
      JobFactoryHelpers.failed({
        name: "recent-failed-job",
        updatedAt: recentDate,
      }),
    );
    await monque.initialize();
    monque.start();
    await waitFor(
      async () => {
        const count = await collection.countDocuments({ name: "old-failed-job" });
        return count === 0;
      },
      { timeout: 2000, interval: 50 },
    );
    const oldJob = await collection.findOne({ name: "old-failed-job" });
    expect(oldJob).toBeNull();
    const recentJob = await collection.findOne({ name: "recent-failed-job" });
    expect(recentJob).not.toBeNull();
  });

  it("should handle concurrent cleanup from two instances without data corruption", async () => {
    collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
    const retentionConfig = {
      completed: 5000,
      failed: 5000,
      interval: 100,
    };
    const monque1 = new Monque(db, {
      collectionName,
      pollInterval: 1000,
      jobRetention: retentionConfig,
    });
    const monque2 = new Monque(db, {
      collectionName,
      pollInterval: 1000,
      jobRetention: retentionConfig,
    });
    monqueInstances.push(monque1, monque2);
    const collection = db.collection<Job>(collectionName);
    const now = new Date();
    // 6s ago — should be deleted
    const oldDate = new Date(now.getTime() - 6000);
    // 100ms ago — should survive
    const recentDate = new Date(now.getTime() - 100);
    // Seed jobs for retention test
    await collection.insertMany([
      // Old completed jobs (should be deleted)
      JobFactoryHelpers.completed({ name: "old-completed-1", updatedAt: oldDate }),
      JobFactoryHelpers.completed({ name: "old-completed-2", updatedAt: oldDate }),
      JobFactoryHelpers.completed({ name: "old-completed-3", updatedAt: oldDate }),
      // Old failed jobs (should be deleted)
      JobFactoryHelpers.failed({ name: "old-failed-1", updatedAt: oldDate }),
      JobFactoryHelpers.failed({ name: "old-failed-2", updatedAt: oldDate }),
      JobFactoryHelpers.failed({ name: "old-failed-3", updatedAt: oldDate }),
      // Recent completed jobs (should survive)
      JobFactoryHelpers.completed({ name: "recent-completed-1", updatedAt: recentDate }),
      JobFactoryHelpers.completed({ name: "recent-completed-2", updatedAt: recentDate }),
      // Recent failed jobs (should survive)
      JobFactoryHelpers.failed({ name: "recent-failed-1", updatedAt: recentDate }),
      JobFactoryHelpers.failed({ name: "recent-failed-2", updatedAt: recentDate }),
    ]);
    // Start both instances concurrently
    await monque1.initialize();
    await monque2.initialize();
    monque1.start();
    monque2.start();
    // Wait for cleanup to remove all old jobs
    await waitFor(
      async () => {
        const oldCount = await collection.countDocuments({
          name: { $regex: /^old-/u },
        });
        return oldCount === 0;
      },
      { timeout: 5000, interval: 50 },
    );
    const oldCount = await collection.countDocuments({ name: { $regex: /^old-/u } });
    const recentCount = await collection.countDocuments({ name: { $regex: /^recent-/u } });
    const totalCount = await collection.countDocuments({});
    const recentJobs = await collection.find({ name: { $regex: /^recent-/u } }).toArray();
    expect({
      oldCount,
      recentCount,
      totalCount,
      names: recentJobs.map((job) => job.name).toSorted(),
    }).toStrictEqual({
      oldCount: 0,
      recentCount: 4,
      totalCount: 4,
      names: ["recent-completed-1", "recent-completed-2", "recent-failed-1", "recent-failed-2"],
    });
  });

  it("should not delete jobs if retention is not configured", async () => {
    collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
    const monque = new Monque(db, {
      collectionName,
      pollInterval: 1000,
      // No jobRetention
    });
    monqueInstances.push(monque);
    const collection = db.collection<Job>(collectionName);
    const oldDate = new Date(Date.now() - 5000);
    await collection.insertOne(
      JobFactoryHelpers.completed({
        name: "should-keep-job",
        updatedAt: oldDate,
      }),
    );
    await monque.initialize();
    monque.start();
    // Wait a bit to ensure no cleanup happens
    await pauseFor(500);
    const job = await collection.findOne({ name: "should-keep-job" });
    expect(job).not.toBeNull();
  });

  it("cleans up only expired cancelled jobs across concurrent schedulers", async () => {
    collectionName = uniqueCollectionName("cancelled-retention");
    const collection = db.collection<Job>(collectionName);
    const oldDate = new Date(Date.now() - 60_000);
    const expired = JobFactoryHelpers.cancelled({ updatedAt: oldDate });
    const retained = [
      JobFactoryHelpers.cancelled({ createdAt: oldDate }),
      JobFactoryHelpers.completed({ updatedAt: oldDate }),
      JobFactoryHelpers.failed({ updatedAt: oldDate }),
      JobFactoryHelpers.pending({ updatedAt: oldDate }),
      JobFactoryHelpers.processing({ updatedAt: oldDate }),
    ];
    await collection.insertMany([expired, ...retained]);
    const options = {
      collectionName,
      jobRetention: { cancelled: 30_000, interval: 50 },
    };
    const first = new Monque(db, options);
    const second = new Monque(db, options);
    monqueInstances.push(first, second);
    await first.initialize();
    await second.initialize();
    first.start();
    second.start();
    await waitFor(async () => (await first.getJob(expired._id)) === null);
    await collection.insertOne(JobFactoryHelpers.cancelled({ updatedAt: oldDate }));
    await waitFor(async () => {
      const awaitedResult1 = await first.getJobs({ status: JobStatus.CANCELLED });
      return awaitedResult1.length === 1;
    });
    await forEachSequential(retained, async (job) => {
      const awaitedResult2 = await first.getJob(job._id);
      expect(awaitedResult2?.status).toBe(job.status);
    });
  });

  it("keeps cancelled jobs when only completed retention is configured", async () => {
    collectionName = uniqueCollectionName("cancelled-default");
    const oldDate = new Date(Date.now() - 60_000);
    const cancelled = JobFactoryHelpers.cancelled({ updatedAt: oldDate });
    const completed = JobFactoryHelpers.completed({ updatedAt: oldDate });
    await db.collection<Job>(collectionName).insertMany([cancelled, completed]);
    const monque = new Monque(db, { collectionName, jobRetention: { completed: 0 } });
    monqueInstances.push(monque);
    await monque.initialize();
    monque.start();
    await waitFor(async () => (await monque.getJob(completed._id)) === null);
    const awaitedResult3 = await monque.getJob(cancelled._id);
    expect(awaitedResult3?.status).toBe(JobStatus.CANCELLED);
  });

  it("accepts zero cancelled retention and preserves existing retention indexes", async () => {
    collectionName = uniqueCollectionName("cancelled-upgrade");
    const collection = db.collection<Job>(collectionName);
    await collection.createIndex(
      { status: 1, updatedAt: 1 },
      {
        background: true,
        partialFilterExpression: {
          status: { $in: [JobStatus.COMPLETED, JobStatus.FAILED] },
          updatedAt: { $exists: true },
        },
      },
    );
    const monque = new Monque(db, { collectionName, jobRetention: { cancelled: 0 } });
    monqueInstances.push(monque);
    await monque.initialize();
    const job = await monque.enqueue("cancel-me", {});
    await monque.cancelJob(job._id.toHexString());
    monque.start();
    await waitFor(async () => (await monque.getJob(job._id)) === null);
    const awaitedResult4 = await collection.indexes();
    expect(awaitedResult4.some((index) => index.name === "status_1_updatedAt_1")).toBe(true);
  });
});
