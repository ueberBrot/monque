import type { Db } from "mongodb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import type { QueueStats } from "@/jobs";
import { Monque } from "@/scheduler";
import {
  cleanupTestDb,
  getTestDb,
  stopMonqueInstances,
  uniqueCollectionName,
} from "@test-utils/test-utils";

type QueueStatsCounts = Omit<QueueStats, "avgProcessingDurationMs">;
const zeroQueueStats: QueueStatsCounts = {
  pending: 0,
  processing: 0,
  completed: 0,
  failed: 0,
  cancelled: 0,
  total: 0,
};
const queueStats = (overrides: Partial<QueueStatsCounts> = {}): QueueStats => ({
  ...zeroQueueStats,
  ...overrides,
});
describe("Management APIs: Queue View Summaries", () => {
  let db: Db;
  const monqueInstances: Monque[] = [];
  const createInitializedMonque = async (collectionNamePrefix: string): Promise<Monque> => {
    const collectionName = uniqueCollectionName(collectionNamePrefix);
    const monque = new Monque(db, { collectionName, statsCacheTtlMs: 0 });
    monqueInstances.push(monque);
    await monque.initialize();
    return monque;
  };
  beforeAll(async () => {
    db = await getTestDb("queue-view-api");
  });

  afterEach(async () => {
    await stopMonqueInstances(monqueInstances);
    monqueInstances.length = 0;
  });

  afterAll(async () => {
    await cleanupTestDb(db);
  });
  describe("getQueueViewSummaries", () => {
    it("refreshes effective worker policies and pause state even while counts are cached", async () => {
      const monque = new Monque(db, {
        collectionName: uniqueCollectionName("worker_policies"),
        statsCacheTtlMs: 60_000,
        maxRetries: 2,
        baseRetryInterval: 25,
      });
      monqueInstances.push(monque);
      await monque.initialize();
      monque.register("default", () => {});
      monque.register("custom", () => {}, {
        maxRetries: 4,
        baseRetryInterval: 0,
        maxBackoffDelay: 100,
        schema: z.object({}),
      });
      const before = await monque.getQueueViewSummaries();
      expect(before).toMatchObject([
        {
          name: "custom",
          worker: {
            paused: false,
            hasSchema: true,
            maxRetries: 4,
            baseRetryInterval: 0,
            maxBackoffDelay: 100,
          },
        },
        {
          name: "default",
          worker: {
            paused: false,
            hasSchema: false,
            maxRetries: 2,
            baseRetryInterval: 25,
            maxBackoffDelay: 86_400_000,
          },
        },
      ]);
      monque.pause();
      const awaitedResult1 = await monque.getQueueViewSummaries();
      expect(awaitedResult1.every((view) => view.worker?.paused === true)).toBe(true);
      monque.resume();
      monque.pause("custom");
      monque.register("custom", () => {}, { replace: true, maxRetries: 1 });
      await expect(monque.getQueueViewSummaries()).resolves.toMatchObject([
        {
          name: "custom",
          worker: { paused: true, hasSchema: false, maxRetries: 1, baseRetryInterval: 25 },
        },
        { name: "default", worker: { paused: false } },
      ]);
      expect(before[0]?.worker).toMatchObject({ paused: false, hasSchema: true, maxRetries: 4 });
    });

    it("filters persisted and worker-only names with isolated caches and mutation invalidation", async () => {
      const monque = new Monque(db, {
        collectionName: uniqueCollectionName("filtered_views"),
        statsCacheTtlMs: 60_000,
      });
      monqueInstances.push(monque);
      await monque.initialize();
      const job = await monque.enqueue("alpha", {});
      await monque.enqueue("beta", {});
      monque.register("worker-only", () => {});
      await expect(monque.getQueueViewSummaries()).resolves.toHaveLength(3);
      expect({
        alpha: await monque.getQueueViewSummaries({ name: "alpha" }),
        beta: await monque.getQueueViewSummaries({ name: "beta" }),
        workerOnly: await monque.getQueueViewSummaries({ name: "worker-only" }),
      }).toMatchObject({
        alpha: [
          {
            name: "alpha",
            hasPersistedJobs: true,
            hasRegisteredWorker: false,
            stats: { pending: 1 },
          },
        ],
        beta: [{ name: "beta" }],
        workerOnly: [
          {
            name: "worker-only",
            hasPersistedJobs: false,
            hasRegisteredWorker: true,
            stats: { total: 0 },
          },
        ],
      });
      await expect(monque.getQueueViewSummaries({ name: "missing" })).resolves.toStrictEqual([]);
      await monque.cancelJob(job._id.toHexString());
      await expect(monque.getQueueViewSummaries({ name: "alpha" })).resolves.toMatchObject([
        { name: "alpha", stats: { pending: 0, cancelled: 1 } },
      ]);
      await expect(monque.getQueueViewSummaries()).resolves.toHaveLength(3);
    });

    it("cached counts remain isolated, workers stay fresh, and mutations invalidate snapshots", async () => {
      const monque = new Monque(db, {
        collectionName: uniqueCollectionName("cached_views"),
        statsCacheTtlMs: 60_000,
      });
      monqueInstances.push(monque);
      await monque.initialize();
      const job = await monque.enqueue("email", {});
      const views = await monque.getQueueViewSummaries();
      const [first] = views;
      if (!first) {
        throw new Error("Expected queue");
      }
      expect(Object.isFrozen(first.stats)).toBe(true);
      monque.register("new-worker", () => {});
      await expect(monque.getQueueViewSummaries()).resolves.toMatchObject([
        { name: "email", stats: { pending: 1 } },
        { name: "new-worker", hasRegisteredWorker: true },
      ]);
      await monque.getQueueStats();
      await monque.cancelJob(job._id.toHexString());
      await expect(monque.getQueueViewSummaries()).resolves.toMatchObject([
        { name: "email", stats: { pending: 0, cancelled: 1 } },
        { name: "new-worker" },
      ]);
      await expect(monque.getQueueStats()).resolves.toMatchObject({ pending: 0, cancelled: 1 });
    });

    it("returns an empty list when no persisted jobs or workers exist", async () => {
      const monque = await createInitializedMonque("queue_view_empty");
      await expect(monque.getQueueViewSummaries()).resolves.toStrictEqual([]);
    });

    it("returns persisted job names sorted by name with statistics", async () => {
      const monque = await createInitializedMonque("queue_view_persisted");
      await monque.enqueue("report-daily", { reportId: 1 });
      await monque.enqueue("email-send", { emailId: 1 });
      await monque.enqueue("email-send", { emailId: 2 });
      const summaries = await monque.getQueueViewSummaries();
      expect(summaries).toMatchObject([
        {
          name: "email-send",
          hasPersistedJobs: true,
          hasRegisteredWorker: false,
          stats: queueStats({ pending: 2, total: 2 }),
          worker: null,
        },
        {
          name: "report-daily",
          hasPersistedJobs: true,
          hasRegisteredWorker: false,
          stats: queueStats({ pending: 1, total: 1 }),
          worker: null,
        },
      ]);
    });

    it("includes historical-only, worker-only, and mixed queue views sorted by name", async () => {
      const monque = await createInitializedMonque("queue_view_mixed");
      monque.register("billing-sync", () => {}, { concurrency: 4 });
      monque.register("zeta-worker-only", () => {}, { concurrency: 2 });
      await monque.enqueue("alpha-history-only", { reportId: 1 });
      await monque.enqueue("billing-sync", { accountId: 1 });
      await monque.enqueue("billing-sync", { accountId: 2 });
      const summaries = await monque.getQueueViewSummaries();
      expect(summaries).toMatchObject([
        {
          name: "alpha-history-only",
          hasPersistedJobs: true,
          hasRegisteredWorker: false,
          stats: queueStats({ pending: 1, total: 1 }),
          worker: null,
        },
        {
          name: "billing-sync",
          hasPersistedJobs: true,
          hasRegisteredWorker: true,
          stats: queueStats({ pending: 2, total: 2 }),
          worker: {
            concurrency: 4,
            activeCount: 0,
          },
        },
        {
          name: "zeta-worker-only",
          hasPersistedJobs: false,
          hasRegisteredWorker: true,
          stats: queueStats(),
          worker: {
            concurrency: 2,
            activeCount: 0,
          },
        },
      ]);
    });
  });
});
