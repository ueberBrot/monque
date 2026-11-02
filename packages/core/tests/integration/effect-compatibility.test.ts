import { it as effectIt } from "@effect/vitest";
import { DateTime, Effect, Layer, Random } from "effect";
import { TestClock } from "effect/testing";
import type { Db } from "mongodb";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { JobStatus, Monque, NonRetryableError, ShutdownTimeoutError } from "@/index";
import type { MonqueEventMap } from "@/index";
import { JobOwnership, makeNativeJobOwnershipLayer } from "@/scheduler/services/job-ownership.js";
import {
  JobPersistence,
  makeNativeJobPersistenceLayer,
} from "@/scheduler/services/job-persistence.js";
import {
  cleanupTestDb,
  getTestDb,
  stopMonqueInstances,
  uniqueCollectionName,
  waitFor,
} from "@test-utils/test-utils";
import { JobFactoryHelpers } from "@tests/factories";

class DeliveryError extends Error {
  override name = "DeliveryError";
  readonly code = "DELIVERY_REJECTED";
}

describe("Promise worker compatibility", () => {
  let db: Db;
  const instances: Monque[] = [];
  beforeAll(async () => {
    db = await getTestDb("effect-compatibility");
  });
  afterEach(async () => {
    await stopMonqueInstances(instances);
  });

  afterAll(async () => {
    await cleanupTestDb(db);
  });

  it.each([
    {
      description: "non-retryable error",
      error: new NonRetryableError("Account deleted"),
      maxRetries: 10,
    },
    { description: "custom error", error: new DeliveryError("Delivery rejected"), maxRetries: 1 },
  ])(
    "preserves the original $description in terminal failure events",
    async ({ error, maxRetries }) => {
      const monque = new Monque(db, {
        collectionName: uniqueCollectionName("failure-identity"),
        pollInterval: 20,
        safetyPollInterval: 20,
        maxRetries,
      });

      instances.push(monque);
      await monque.initialize();
      const failures: MonqueEventMap["job:fail"][] = [];
      monque.on("job:fail", (event) => {
        failures.push(event);
      });
      monque.register("delivery", vi.fn<() => Promise<void>>().mockRejectedValue(error));
      const job = await monque.enqueue("delivery", {});
      monque.start();
      await waitFor(() => failures.length === 1);
      await monque.stop();
      expect({
        failures: failures.length,
        originalError: failures[0]?.error === error,
        failures0WillRetry: failures[0]?.willRetry,
      }).toStrictEqual({
        failures: 1,
        originalError: true,
        failures0WillRetry: false,
      });
      await expect(monque.getJob(job._id)).resolves.toMatchObject({
        status: JobStatus.FAILED,
        failCount: 1,
        failReason: error.message,
      });
      await expect(monque.getQueueViewSummaries({ name: "delivery" })).resolves.toMatchObject([
        { stats: { pending: 0, processing: 0, failed: 1 }, worker: { activeCount: 0 } },
      ]);
    },
  );

  it("retains a timed-out Promise worker and its capacity across restart until it completes", async () => {
    const monque = new Monque(db, {
      collectionName: uniqueCollectionName("shutdown-restart"),
      pollInterval: 20,
      safetyPollInterval: 20,
      shutdownTimeout: 100,
      workerConcurrency: 1,
      statsCacheTtlMs: 0,
    });

    instances.push(monque);
    await monque.initialize();
    const releaseFirst: PromiseWithResolvers<void> = Promise.withResolvers();
    const releaseSecond: PromiseWithResolvers<void> = Promise.withResolvers();
    const started: number[] = [];
    const completed: number[] = [];
    const shutdownErrors: ShutdownTimeoutError[] = [];
    let active = 0;
    let peakActive = 0;
    let firstFinished = false;
    monque.on("job:error", ({ error }) => {
      if (error instanceof ShutdownTimeoutError) {
        shutdownErrors.push(error);
      }
    });
    monque.on("job:complete", ({ job }) => {
      if (job.name === "delivery") {
        completed.push(z.object({ sequence: z.number() }).parse(job.data).sequence);
      }
    });
    monque.register<{
      sequence: number;
    }>("delivery", async (job) => {
      started.push(job.data.sequence);
      active += 1;
      peakActive = Math.max(peakActive, active);

      try {
        if (job.data.sequence === 1) {
          await releaseFirst.promise;
          firstFinished = true;
        } else {
          await releaseSecond.promise;
        }
      } finally {
        active -= 1;
      }
    });
    monque.register("checkpoint", vi.fn<() => Promise<void>>().mockResolvedValue(undefined));
    const first = await monque.enqueue("delivery", { sequence: 1 });
    monque.start();

    try {
      await waitFor(() => started.length === 1);
      await expect(monque.stop()).resolves.toBeUndefined();
      const stoppedJob = await monque.getJob(first._id);
      const stoppedQueues = await monque.getQueueViewSummaries({ name: "delivery" });
      expect({
        shutdownErrors: shutdownErrors.length,
        incompleteJobIds: shutdownErrors[0]?.incompleteJobs.map((job) => job._id?.toString()),
        firstFinished,
        completed,
        job: stoppedJob,
        queueViews: stoppedQueues,
      }).toMatchObject({
        shutdownErrors: 1,
        incompleteJobIds: [first._id.toString()],
        firstFinished: false,
        completed: [],
        job: { status: JobStatus.PROCESSING },
        queueViews: [{ worker: { concurrency: 1, activeCount: 1 } }],
      });
      const second = await monque.enqueue("delivery", { sequence: 2 });
      const checkpoint = await monque.enqueue("checkpoint", {});
      monque.start();
      await waitFor(async () => {
        const awaitedResult1 = await monque.getJob(checkpoint._id);

        return awaitedResult1?.status === JobStatus.COMPLETED;
      });
      const waitingJob = await monque.getJob(second._id);
      const restartedQueues = await monque.getQueueViewSummaries({ name: "delivery" });
      expect({ started, job: waitingJob, queueViews: restartedQueues }).toMatchObject({
        started: [1],
        job: { status: JobStatus.PENDING },
        queueViews: [{ stats: { pending: 1, processing: 1 }, worker: { activeCount: 1 } }],
      });
      releaseFirst.resolve();
      await waitFor(() => started.length === 2 && completed.includes(1));
      const completedFirstJob = await monque.getJob(first._id);
      const releasedQueues = await monque.getQueueViewSummaries({ name: "delivery" });
      expect({
        firstFinished,
        started,
        peakActive,
        job: completedFirstJob,
        queueViews: releasedQueues,
      }).toMatchObject({
        firstFinished: true,
        started: [1, 2],
        peakActive: 1,
        job: { status: JobStatus.COMPLETED },
        queueViews: [
          { stats: { pending: 0, processing: 1, completed: 1 }, worker: { activeCount: 1 } },
        ],
      });
      releaseSecond.resolve();
      await waitFor(async () => {
        const awaitedResult2 = await monque.getQueueViewSummaries({ name: "delivery" });
        const [summary] = awaitedResult2;

        return summary?.stats.completed === 2 && summary.worker?.activeCount === 0;
      });
      expect({
        completed,
        peakActive,
        active,
        shutdownErrors: shutdownErrors.length,
      }).toStrictEqual({
        completed: [1, 2],
        peakActive: 1,
        active: 0,
        shutdownErrors: 1,
      });
    } finally {
      releaseFirst.resolve();
      releaseSecond.resolve();
      await monque.stop();
      await waitFor(async () => {
        const awaitedResult3 = await monque.getQueueViewSummaries({ name: "delivery" });
        const [summary] = awaitedResult3;

        return active === 0 && summary?.worker?.activeCount === 0;
      });
    }
  });
});

const ownershipOptions = {
  heartbeatInterval: 1000,
  lockTimeout: 30_000,
  maxRetries: 3,
  baseRetryInterval: 1000,
  maxBackoffDelay: 10_000,
};

describe("ownership with controlled Effect services", () => {
  let db: Db;
  beforeAll(async () => {
    db = await getTestDb("ownership-clock");
  });

  afterAll(async () => {
    await cleanupTestDb(db);
  });

  effectIt.effect("uses server time for renewable authority despite local clock changes", () =>
    Effect.gen(function* serverAuthority() {
      const collection = db.collection(uniqueCollectionName("clock-skew"));
      const pending = JobFactoryHelpers.pending({ name: "work", nextRunAt: new Date(0) });
      yield* Effect.promise(async () => await collection.insertOne(pending));

      const layer = Layer.merge(
        makeNativeJobOwnershipLayer(collection, "$clock-owner", {
          ...ownershipOptions,
          leaseDuration: 30_000,
        }),
        makeNativeJobPersistenceLayer(collection),
      );

      yield* Effect.gen(function* renewableTransitions() {
        const store = yield* JobOwnership;
        const reads = yield* JobPersistence;
        yield* TestClock.setTime(Date.UTC(2099, 0, 1));
        const before = Date.now();
        const claimed = yield* store.claimNext("work");

        if (claimed?.claimId === undefined || !claimed.lockedAt || !claimed.leaseExpiresAt) {
          throw new Error("Expected a renewable Claim");
        }

        expect({
          status: claimed.status,
          instance: claimed.claimedBy,
          usesServerTime:
            claimed.lockedAt.getTime() >= before && claimed.lockedAt.getTime() <= Date.now(),
          duration: claimed.leaseExpiresAt.getTime() - claimed.lockedAt.getTime(),
        }).toStrictEqual({
          status: JobStatus.PROCESSING,
          instance: "$clock-owner",
          usesServerTime: true,
          duration: 30_000,
        });
        yield* TestClock.setTime(0);
        yield* store.updateOwnedHeartbeats([claimed.claimId]);
        const renewed = yield* reads.getJob(pending._id);
        expect({
          heartbeatUsesServerTime: (renewed?.lastHeartbeat?.getTime() ?? 0) >= before,
          renewedDeadline:
            (renewed?.leaseExpiresAt?.getTime() ?? 0) >= claimed.leaseExpiresAt.getTime(),
        }).toStrictEqual({ heartbeatUsesServerTime: true, renewedDeadline: true });

        // Native fixture mutation establishes expiry without a wall-clock wait.
        yield* Effect.promise(
          async () =>
            await collection.updateOne(
              { _id: pending._id },
              { $set: { leaseExpiresAt: new Date(0) } },
            ),
        );
        yield* store.updateOwnedHeartbeats([claimed.claimId]);
        expect({
          completion: yield* store.completeOwned(claimed),
          failure: yield* store.failOwned(claimed, new Error("late")),
        }).toStrictEqual({ completion: null, failure: null });
        yield* store.releaseOwnedClaim(claimed);
        const expired = yield* reads.getJob(pending._id);
        const count = yield* store.recoverStaleJobs;
        const recovered = yield* reads.getJob(pending._id);
        expect({ expired, count, recovered }).toMatchObject({
          expired: {
            status: JobStatus.PROCESSING,
            claimId: claimed.claimId,
            leaseExpiresAt: new Date(0),
            failCount: 0,
          },
          count: 1,
          recovered: { status: JobStatus.PENDING },
        });
        const replacement = yield* store.claimNext("work");

        if (replacement?.claimId === undefined) {
          throw new Error("Expected a replacement Claim");
        }

        yield* store.releaseOwnedClaim(claimed);
        const afterLateRelease = yield* reads.getJob(pending._id);
        expect({
          recoveredClaim: recovered?.claimId,
          replacementClaim: afterLateRelease?.claimId,
          status: afterLateRelease?.status,
        }).toStrictEqual({
          recoveredClaim: undefined,
          replacementClaim: replacement.claimId,
          status: JobStatus.PROCESSING,
        });
      }).pipe(Effect.provide(layer));
    }),
  );

  effectIt.effect("persists deterministic retry jitter and recurring timezone metadata", () =>
    Effect.gen(function* durableSchedules() {
      const collection = db.collection(uniqueCollectionName("retry-clock"));

      const pending = JobFactoryHelpers.pending({
        name: "work",
        nextRunAt: new Date(0),
        priority: 7,
        repeatInterval: "0 9 * * *",
        timezone: "Europe/Berlin",
      });

      yield* Effect.promise(async () => await collection.insertOne(pending));
      yield* Effect.gen(function* scheduledTransitions() {
        const store = yield* JobOwnership;
        yield* TestClock.setTime(Date.UTC(2026, 0, 1, 7));
        const claimed = yield* store.claimNext("work");

        if (!claimed) {
          throw new Error("Expected a Claim");
        }

        const retried = yield* store.failOwned(claimed, new Error("retry me"));
        expect(retried).toMatchObject({
          status: JobStatus.PENDING,
          priority: 7,
          failCount: 1,
          failReason: "retry me",
          nextRunAt: new Date("2026-01-01T07:00:02.250Z"),
        });
        expect(retried?.claimId).toBeUndefined();
        yield* TestClock.adjust(2250);
        const nextClaim = yield* store.claimNext("work");

        if (!nextClaim) {
          throw new Error("Expected the retry Claim");
        }

        const completed = yield* store.completeOwned(nextClaim);
        expect(completed).toMatchObject({
          status: JobStatus.PENDING,
          priority: 7,
          failCount: 0,
          nextRunAt: new Date("2026-01-01T08:00:00.000Z"),
          timezone: "Europe/Berlin",
        });
        expect({
          failReason: completed?.failReason,
          claimId: completed?.claimId,
          updatedAt: completed?.updatedAt,
        }).toStrictEqual({
          failReason: undefined,
          claimId: undefined,
          updatedAt: yield* DateTime.nowAsDate,
        });
      }).pipe(
        Effect.provide(makeNativeJobOwnershipLayer(collection, "clock-owner", ownershipOptions)),
        Effect.provideService(Random.Random, {
          nextDoubleUnsafe: () => 0.75,
          nextIntUnsafe: () => 0,
        }),
      );
    }),
  );
});
