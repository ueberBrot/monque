import type { Db, Document } from "mongodb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";

import { JobStatus } from "@/jobs";
import { Monque } from "@/scheduler";
import {
  cleanupTestDb,
  getTestDb,
  stopMonqueInstances,
  uniqueCollectionName,
} from "@test-utils/test-utils";
import { JobFactoryHelpers } from "@tests/factories";

import { forEachSequential } from "./helpers";

const LargeStatsJobBuilder = {
  buildBatch(
    status: (typeof JobStatus)[keyof typeof JobStatus],
    count: number,
    jobName: string,
    startIndex: number,
  ): Document[] {
    const now = new Date();
    return Array.from({ length: count }, (_, index) => {
      const document: Document = {
        name: jobName,
        data: { task: startIndex + index },
        status,
        failCount: status === JobStatus.FAILED ? 10 : 0,
        createdAt: now,
        updatedAt: now,
        nextRunAt: now,
      };
      if (status === JobStatus.PROCESSING) {
        document["lockedAt"] = now;
        document["claimedBy"] = "test-instance";
        document["lastHeartbeat"] = now;
      }
      return document;
    });
  },
};
describe("Management APIs: Queue Statistics", () => {
  let db: Db;
  let monque: Monque;
  const monqueInstances: Monque[] = [];
  const queueName = "statistics-test-queue";
  beforeAll(async () => {
    db = await getTestDb("statistics-api");
  });

  afterEach(async () => {
    await stopMonqueInstances(monqueInstances);
  });

  afterAll(async () => {
    await cleanupTestDb(db);
  });
  describe("getQueueStats", () => {
    it("returns zero counts for empty queue", async () => {
      const collectionName = uniqueCollectionName("stats_empty");
      monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const stats = await monque.getQueueStats();
      expect({
        statsPending: stats.pending,
        statsProcessing: stats.processing,
        statsCompleted: stats.completed,
        statsFailed: stats.failed,
        statsCancelled: stats.cancelled,
        statsTotal: stats.total,
        statsAvgProcessingDurationMs: stats.avgProcessingDurationMs,
      }).toStrictEqual({
        statsPending: 0,
        statsProcessing: 0,
        statsCompleted: 0,
        statsFailed: 0,
        statsCancelled: 0,
        statsTotal: 0,
        statsAvgProcessingDurationMs: undefined,
      });
    });

    it("returns correct counts for mixed status jobs", async () => {
      const collectionName = uniqueCollectionName("stats_mixed");
      monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      // Create jobs in various statuses
      // pending
      await monque.enqueue(queueName, { task: 1 });
      // pending
      await monque.enqueue(queueName, { task: 2 });
      // pending
      await monque.enqueue(queueName, { task: 3 });
      // Insert jobs directly into DB for other statuses
      const processingDoc = JobFactoryHelpers.processing({
        name: queueName,
        data: { task: 4 },
      });
      await db.collection(collectionName).insertOne(processingDoc);
      const completedDocs = [
        JobFactoryHelpers.completed({ name: queueName, data: { task: 5 } }),
        JobFactoryHelpers.completed({ name: queueName, data: { task: 6 } }),
      ];
      await db.collection(collectionName).insertMany(completedDocs);
      const failedDoc = JobFactoryHelpers.failed({ name: queueName, data: { task: 7 } });
      await db.collection(collectionName).insertOne(failedDoc);
      const cancelledDocs = [
        JobFactoryHelpers.cancelled({ name: queueName, data: { task: 8 } }),
        JobFactoryHelpers.cancelled({ name: queueName, data: { task: 9 } }),
      ];
      await db.collection(collectionName).insertMany(cancelledDocs);
      const stats = await monque.getQueueStats();
      expect({
        statsPending: stats.pending,
        statsProcessing: stats.processing,
        statsCompleted: stats.completed,
        statsFailed: stats.failed,
        statsCancelled: stats.cancelled,
        statsTotal: stats.total,
      }).toStrictEqual({
        statsPending: 3,
        statsProcessing: 1,
        statsCompleted: 2,
        statsFailed: 1,
        statsCancelled: 2,
        statsTotal: 9,
      });
    });

    it("filters statistics by job name", async () => {
      const collectionName = uniqueCollectionName("stats_filter_name");
      monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      // Create jobs with different names
      await monque.enqueue("email-queue", { task: 1 });
      await monque.enqueue("email-queue", { task: 2 });
      await monque.enqueue("sms-queue", { task: 3 });
      const completedEmail = JobFactoryHelpers.completed({
        name: "email-queue",
        data: { task: 4 },
      });
      await db.collection(collectionName).insertOne(completedEmail);
      const completedSms = JobFactoryHelpers.completed({
        name: "sms-queue",
        data: { task: 5 },
      });
      await db.collection(collectionName).insertOne(completedSms);
      // Get stats for email-queue only
      const emailStats = await monque.getQueueStats({ name: "email-queue" });
      expect({
        emailStatsPending: emailStats.pending,
        emailStatsCompleted: emailStats.completed,
        emailStatsTotal: emailStats.total,
      }).toStrictEqual({
        emailStatsPending: 2,
        emailStatsCompleted: 1,
        emailStatsTotal: 3,
      });
      // Get stats for sms-queue
      const smsStats = await monque.getQueueStats({ name: "sms-queue" });
      expect({
        smsStatsPending: smsStats.pending,
        smsStatsCompleted: smsStats.completed,
        smsStatsTotal: smsStats.total,
      }).toStrictEqual({
        smsStatsPending: 1,
        smsStatsCompleted: 1,
        smsStatsTotal: 2,
      });
    });

    it("calculates average processing duration correctly", async () => {
      const collectionName = uniqueCollectionName("stats_avg_duration");
      monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      // Create completed jobs with known processing durations (createdAt -> updatedAt)
      const now = new Date();
      // Job 1: 1000ms processing time (createdAt to updatedAt)
      const job1 = JobFactoryHelpers.completed({
        name: queueName,
        data: { task: 1 },
        createdAt: new Date(now.getTime() - 1000),
        updatedAt: now,
      });
      // Job 2: 2000ms processing time
      const job2 = JobFactoryHelpers.completed({
        name: queueName,
        data: { task: 2 },
        createdAt: new Date(now.getTime() - 2000),
        updatedAt: now,
      });
      // Job 3: 3000ms processing time
      const job3 = JobFactoryHelpers.completed({
        name: queueName,
        data: { task: 3 },
        createdAt: new Date(now.getTime() - 3000),
        updatedAt: now,
      });
      await db.collection(collectionName).insertMany([job1, job2, job3]);
      const stats = await monque.getQueueStats();
      // Average of 1000, 2000, 3000 = 2000ms
      expect(stats.avgProcessingDurationMs).toBeDefined();
      expect({
        statsAvgProcessingDurationMs: stats.avgProcessingDurationMs,
        statsCompleted: stats.completed,
      }).toStrictEqual({
        statsAvgProcessingDurationMs: 2000,
        statsCompleted: 3,
      });
    });

    it("includes all completed jobs in avg calculation regardless of lockedAt", async () => {
      const collectionName = uniqueCollectionName("stats_no_locked");
      monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const now = new Date();
      // Job with lockedAt (1000ms processing time)
      const jobWithLockedAt = JobFactoryHelpers.completed({
        name: queueName,
        data: { task: 1 },
        createdAt: new Date(now.getTime() - 1000),
        updatedAt: now,
        // Has lockedAt but we don't use it
        lockedAt: new Date(now.getTime() - 500),
      });
      // Job without lockedAt (2000ms processing time)
      const jobWithoutLockedAt = {
        ...JobFactoryHelpers.completed({
          name: queueName,
          data: { task: 2 },
          createdAt: new Date(now.getTime() - 2000),
          updatedAt: now,
        }),
        lockedAt: null,
      };
      await db.collection(collectionName).insertMany([jobWithLockedAt, jobWithoutLockedAt]);
      const stats = await monque.getQueueStats();
      // Both jobs should be included in average: (1000 + 2000) / 2 = 1500ms
      expect(stats.completed).toBe(2);
      expect(stats.avgProcessingDurationMs).toBeDefined();
      expect(stats.avgProcessingDurationMs).toBe(1500);
    });

    it("handles large dataset efficiently", async () => {
      const collectionName = uniqueCollectionName("stats_large");
      monque = new Monque(db, {
        collectionName,
        skipIndexCreation: true,
      });
      monqueInstances.push(monque);
      await monque.initialize();
      // Create 100K jobs - 20K per status
      const countPerStatus = 20_000;
      const batchSize = 5000;
      const statuses = [
        JobStatus.PENDING,
        JobStatus.PROCESSING,
        JobStatus.COMPLETED,
        JobStatus.FAILED,
        JobStatus.CANCELLED,
      ] as const;
      let taskIndex = 0;
      await forEachSequential(statuses, async (status) => {
        await forEachSequential(
          Array.from({ length: countPerStatus / batchSize }, (_, index) => index * batchSize),
          async (inserted) => {
            const size = Math.min(batchSize, countPerStatus - inserted);
            const batch = LargeStatsJobBuilder.buildBatch(status, size, queueName, taskIndex);
            taskIndex += size;
            await db.collection(collectionName).insertMany(batch, { ordered: false });
          },
        );
      });
      // Verify job count
      const count = await db.collection(collectionName).countDocuments();
      expect(count).toBe(100_000);
      // Measure performance
      const startTime = Date.now();
      const stats = await monque.getQueueStats();
      const duration = Date.now() - startTime;
      // Must complete within 5 seconds per spec
      expect(duration).toBeLessThan(5000);
      // Verify correct distribution (20K each)
      expect({
        statsPending: stats.pending,
        statsProcessing: stats.processing,
        statsCompleted: stats.completed,
        statsFailed: stats.failed,
        statsCancelled: stats.cancelled,
        statsTotal: stats.total,
      }).toStrictEqual({
        statsPending: 20_000,
        statsProcessing: 20_000,
        statsCompleted: 20_000,
        statsFailed: 20_000,
        statsCancelled: 20_000,
        statsTotal: 100_000,
      });
      // 30 second timeout for the test itself
    }, 30_000);
  });
});
