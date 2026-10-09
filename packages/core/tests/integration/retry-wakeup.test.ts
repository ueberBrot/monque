import { EventEmitter } from "node:events";
import { fromAny } from "@total-typescript/shoehorn";
import { Collection } from "mongodb";
import type { Db } from "mongodb";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { JobStatus } from "@/jobs";
import type { Job } from "@/jobs";
import { Monque } from "@/scheduler";
import {
  cleanupTestDb,
  clearCollection,
  getTestDb,
  stopMonqueInstances,
  uniqueCollectionName,
  waitFor,
} from "@test-utils/test-utils.js";

describe("local retry wakeups", () => {
  let db: Db;
  let collectionName: string;
  const instances: Monque[] = [];
  beforeAll(async () => {
    db = await getTestDb("retry-wakeup");
  });
  afterEach(async () => {
    await stopMonqueInstances(instances);
    vi.restoreAllMocks();
    await clearCollection(db, collectionName);
  });

  afterAll(async () => {
    await cleanupTestDb(db);
  });

  it.each([JobStatus.COMPLETED, JobStatus.FAILED])(
    "reaches %s without change-stream delivery or a safety poll",
    async (terminalStatus) => {
      // A cursor can be opening while the initial poll processes the first attempt.
      // Keep the stream active, but suppress delivery to reproduce missed notifications.
      vi.spyOn(Collection.prototype, "watch").mockReturnValue(
        fromAny<ReturnType<Collection["watch"]>, unknown>(
          // oxlint-disable-next-line unicorn/prefer-event-target -- MongoDB change streams implement Node EventEmitter subscriptions.
          Object.assign(new EventEmitter(), {
            close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
          }),
        ),
      );
      collectionName = uniqueCollectionName("retry_wakeup");
      const monque = new Monque(db, {
        collectionName,
        pollInterval: 30_000,
        safetyPollInterval: 30_000,
        maxRetries: 2,
        baseRetryInterval: 10,
        workerConcurrency: 1,
      });
      instances.push(monque);
      await monque.initialize();
      const starts: number[] = [];
      const failures: {
        job: Job;
        willRetry: boolean;
      }[] = [];
      const errors: Error[] = [];
      monque.on("job:fail", (event) => {
        failures.push(event);
      });
      monque.on("job:error", ({ error }) => {
        errors.push(error);
      });
      monque.register("retry", () => {
        starts.push(Date.now());
        if (starts.length === 1 || terminalStatus === JobStatus.FAILED) {
          throw new Error(`Failure ${starts.length}`);
        }
      });
      const job = await monque.enqueue("retry", {});
      monque.start();
      await waitFor(
        async () => {
          const persisted = await db.collection<Job>(collectionName).findOne({ _id: job._id });
          return persisted?.status === terminalStatus;
        },
        { timeout: 5000 },
      );
      await monque.stop();
      expect({
        errors,
        starts: starts.length,
        failuresMapWillRetryWillRetry: failures.map(({ willRetry }) => willRetry),
      }).toStrictEqual({
        errors: [],
        starts: 2,
        failuresMapWillRetryWillRetry: terminalStatus === JobStatus.FAILED ? [true, false] : [true],
      });
      const retry = failures[0]?.job;
      if (!retry) {
        throw new Error("Expected first attempt to schedule a retry");
      }
      expect(starts[1]).toBeGreaterThanOrEqual(retry.nextRunAt.getTime());
      const persisted = await db.collection<Job>(collectionName).findOne({ _id: job._id });
      expect({
        persistedFailCount: persisted?.failCount,
        persistedClaimedBy: persisted?.claimedBy,
      }).toStrictEqual({
        persistedFailCount: terminalStatus === JobStatus.FAILED ? 2 : 1,
        persistedClaimedBy: undefined,
      });
    },
  );
});
