import { ok } from "node:assert/strict";
import { it as effectIt } from "@effect/vitest";
import { Context, DateTime, Effect, Layer, Random } from "effect";
import { TestClock } from "effect/testing";
import { Binary, Decimal128, MongoBulkWriteError, ObjectId } from "mongodb";
import type { Collection, Db } from "mongodb";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { JobStatus, Monque, NonRetryableError, ShutdownTimeoutError } from "@/index";
import type { MonqueEventMap } from "@/index";
import { JobIntake, makeNativeJobIntakeLayer } from "@/scheduler/services/job-intake.js";
import { JobManagement, makeJobManagementLayer } from "@/scheduler/services/job-manager.js";
import { JobOwnership, makeNativeJobOwnershipLayer } from "@/scheduler/services/job-ownership.js";
import {
  JobPersistence,
  makeNativeJobPersistenceLayer,
} from "@/scheduler/services/job-persistence.js";
import { JobQueries, makeJobQueriesLayer } from "@/scheduler/services/job-queries.js";
import { ConnectionError } from "@/shared";
import {
  cleanupTestDb,
  getTestDb,
  stopMonqueInstances,
  uniqueCollectionName,
  waitFor,
} from "@test-utils/test-utils";
import { JobFactoryHelpers } from "@tests/factories";
import { getMongoClient } from "@tests/setup/mongodb";

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

  effectIt.effect(
    "preserves management retry dates, jitter, priority and synchronous notification order",
    () =>
      Effect.gen(function* managementRetryClock() {
        const collection = db.collection(uniqueCollectionName("management-clock"));
        const past = new Date("2025-01-01T00:00:00.000Z");

        const jobs = [-7, 0, 19].map((priority) =>
          JobFactoryHelpers.failed({
            name: "retry",
            priority,
            createdAt: past,
            updatedAt: past,
            claimId: "old-claim",
            claimedBy: "old-owner",
            lockedAt: past,
            lastHeartbeat: past,
            leaseExpiresAt: past,
          }),
        );

        yield* Effect.promise(async () => await collection.insertMany(jobs));
        const order: string[] = [];
        const notifications: { name: string | undefined; nextRunAt: Date }[] = [];

        const fixture = Layer.merge(
          makeJobManagementLayer({
            collection,
            emit: (event) => {
              order.push(event);

              return true;
            },
            notifyPendingJob: (name, nextRunAt) => {
              order.push("pending");
              notifications.push({ name, nextRunAt });
            },
          }),
          makeNativeJobPersistenceLayer(collection),
        ).pipe(
          Layer.provideMerge(
            makeJobQueriesLayer({
              collection,
              options: { ...ownershipOptions, statsCacheTtlMs: 60_000 },
              workerObservations: () => [],
            }),
          ),
        );

        yield* Effect.gen(function* retryManagement() {
          const management = yield* JobManagement;
          const reads = yield* JobQueries;
          const store = yield* JobPersistence;
          yield* TestClock.setTime(Date.UTC(2030, 0, 1));
          const [first] = jobs;

          if (!first) {
            throw new Error("Expected retry fixture");
          }

          const single = yield* management.retryJob(first._id.toHexString());
          expect({ single, order }).toMatchObject({
            single: {
              status: JobStatus.PENDING,
              priority: -7,
              nextRunAt: new Date("2030-01-01T00:00:00.000Z"),
              failCount: 0,
            },
            order: ["pending", "job:retried"],
          });
          yield* TestClock.adjust(60_000);
          const result = yield* management.retryJobs({ name: "retry", status: JobStatus.FAILED });
          const retried = yield* reads.getJobs({ name: "retry", status: JobStatus.PENDING });
          const bulk = retried.filter((job) => !job._id.equals(first._id));
          expect({
            result,
            order,
            priorities: retried.map((job) => job.priority ?? 0).toSorted((a, b) => a - b),
          }).toStrictEqual({
            result: { count: 2, errors: [] },
            order: ["pending", "job:retried", "jobs:retried", "pending", "pending"],
            priorities: [-7, 0, 19],
          });
          const dates = bulk.map((job) => job.nextRunAt.getTime());
          expect({
            jitterInWindow: dates.every(
              (date) => date >= Date.UTC(2030, 0, 1, 0, 1) && date < Date.UTC(2030, 0, 1, 0, 1, 30),
            ),
            notifications: notifications
              .map(({ nextRunAt }) => nextRunAt.getTime())
              .toSorted((a, b) => a - b),
            metadata: retried.map(
              ({
                claimId,
                claimedBy,
                lockedAt,
                lastHeartbeat,
                leaseExpiresAt,
                failReason,
                failCount,
              }) => ({
                claimId,
                claimedBy,
                lockedAt,
                lastHeartbeat,
                leaseExpiresAt,
                failReason,
                failCount,
              }),
            ),
          }).toMatchObject({
            jitterInWindow: true,
            metadata: [0, 1, 2].map(() => ({
              claimId: undefined,
              claimedBy: undefined,
              lockedAt: undefined,
              lastHeartbeat: undefined,
              leaseExpiresAt: undefined,
              failReason: undefined,
              failCount: 0,
            })),
            notifications: retried
              .map(({ nextRunAt }) => nextRunAt.getTime())
              .toSorted((a, b) => a - b),
          });
          expect(yield* store.getJob(first._id)).toMatchObject({
            nextRunAt: single?.nextRunAt,
            priority: -7,
          });
        }).pipe(Effect.provide(fixture));
      }),
  );

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

const IntakeFixture = Context.Service<{
  readonly collection: Collection;
  readonly notifications: [string, Date][];
}>("test/IntakeFixture");

// Each provision acquires an isolated database; the client remains owned by test setup.
const fixture = Layer.unwrap(
  Effect.gen(function* acquireIntakeFixture() {
    const db = yield* Effect.acquireRelease(
      Effect.promise(async () => await getTestDb("intake-effects")),
      (database) =>
        Effect.promise(async () => {
          await cleanupTestDb(database);
        }),
    );

    const monque = new Monque(db);
    yield* Effect.acquireRelease(
      Effect.promise(async () => {
        await monque.initialize();
      }),
      () =>
        Effect.promise(async () => {
          await monque.stop();
        }),
    );
    const collection = db.collection("monque_jobs");
    const notifications: [string, Date][] = [];

    return Layer.mergeAll(
      Layer.succeed(IntakeFixture, { collection, notifications }),
      makeNativeJobIntakeLayer({
        collection,
        options: { maxPayloadSize: 1024 },
        notifyPendingJob: (name, due) => {
          notifications.push([name, due]);
        },
      }),
      makeNativeJobPersistenceLayer(collection),
    );
  }),
);

describe("native intake with controlled Effect time", () => {
  effectIt.effect("persists BSON, initial metadata and due dates across all intake paths", () =>
    Effect.gen(function* nativeIntakeTime() {
      const intake = yield* JobIntake;
      const reads = yield* JobPersistence;
      const { notifications } = yield* IntakeFixture;
      yield* TestClock.setTime(Date.UTC(2026, 2, 28, 12));
      const createdAt = new Date("2026-03-28T12:00:00.000Z");

      const data = {
        id: new ObjectId(),
        amount: Decimal128.fromString("12.34"),
        bytes: new Binary(Buffer.from([0, 127, 255])),
        date: new Date(42),
      };

      const immediate = yield* intake.now("immediate", data, { priority: 8 });
      yield* TestClock.adjust(1000);

      const delayed = yield* intake.enqueue("delayed", data, {
        runAt: new Date("2026-03-29T10:00:00.000Z"),
        priority: -3,
      });

      const recurring = yield* intake.schedule("0 9 * * *", "recurring", data, {
        timezone: "Europe/Berlin",
        uniqueKey: "daily",
        priority: 5,
      });

      const batch = yield* intake.enqueueMany([
        { name: "batch", data, uniqueKey: "one", priority: 2 },
        { name: "batch", data: {}, uniqueKey: "one", priority: 99 },
      ]);

      expect({ immediate, delayed, recurring, batch }).toMatchObject({
        immediate: { nextRunAt: createdAt, createdAt, updatedAt: createdAt, priority: 8 },
        delayed: {
          nextRunAt: new Date("2026-03-29T10:00:00.000Z"),
          createdAt: new Date("2026-03-28T12:00:01.000Z"),
          priority: -3,
        },
        recurring: {
          nextRunAt: new Date("2026-03-29T07:00:00.000Z"),
          repeatInterval: "0 9 * * *",
          timezone: "Europe/Berlin",
          priority: 5,
        },
        batch: { insertedCount: 1, deduplicatedCount: 1 },
      });

      for (const job of [immediate, delayed, recurring]) {
        const stored = yield* reads.getJob(job._id);
        expect(stored).toMatchObject({ data, status: JobStatus.PENDING, failCount: 0 });
        expect(stored).not.toHaveProperty("claimId");
      }

      expect(notifications).toStrictEqual([
        ["immediate", createdAt],
        ["delayed", new Date("2026-03-29T10:00:00.000Z")],
        ["recurring", new Date("2026-03-29T07:00:00.000Z")],
        ["batch", new Date("2026-03-28T12:00:01.000Z")],
      ]);
    }).pipe(Effect.provide(fixture)),
  );
  effectIt.effect(
    "borrows the caller session and suppresses local notifications until commit",
    () =>
      Effect.gen(function* nativeTransactionIntake() {
        const intake = yield* JobIntake;
        const reads = yield* JobPersistence;
        const { collection, notifications } = yield* IntakeFixture;
        const client = yield* Effect.promise(async () => await getMongoClient());

        const session = yield* Effect.acquireRelease(
          Effect.sync(() => client.startSession()),
          (ownedSession) =>
            Effect.promise(async () => {
              await ownedSession.endSession();
            }),
        );

        session.startTransaction();
        const first = yield* intake.enqueue("work", {}, { session, uniqueKey: "one" });
        yield* intake.now("work", {}, { session });
        yield* intake.schedule("@daily", "work", {}, { session, timezone: "UTC" });
        yield* intake.enqueueMany([{ name: "work", data: {} }], { session });

        const inSession = yield* Effect.promise(
          async () => await collection.countDocuments({}, { session }),
        );

        expect({
          inSession,
          visible: yield* reads.getJob(first._id),
          active: session.inTransaction(),
          ended: session.hasEnded,
          notifications,
        }).toStrictEqual({
          inSession: 4,
          visible: null,
          active: true,
          ended: false,
          notifications: [],
        });
        // Only the caller controls commit. Notification delivery afterward belongs to streams/polling.
        yield* Effect.promise(async () => {
          await session.commitTransaction();
        });
        expect(yield* reads.getJob(first._id)).toMatchObject({ name: "work", uniqueKey: "one" });
        yield* intake.enqueue("outside", {}, { session });
        expect({ ended: session.hasEnded, notifications }).toStrictEqual({
          ended: false,
          notifications: [["outside", new Date(0)]],
        });
      }).pipe(Effect.provide(fixture)),
  );

  effectIt.effect(
    "notifies successful pending writes before returning native partial batch details",
    () =>
      Effect.gen(function* partialBatchNotifications() {
        const intake = yield* JobIntake;
        const { collection, notifications } = yield* IntakeFixture;
        yield* Effect.promise(
          async () =>
            await collection.createIndex({ "data.email": 1 }, { unique: true, sparse: true }),
        );
        yield* intake.enqueue("existing", { email: "taken" });
        notifications.length = 0;

        const failure = yield* Effect.flip(
          intake.enqueueMany([
            { name: "first", data: {}, priority: 7 },
            { name: "rejected", data: { email: "taken" }, uniqueKey: "unrelated-index" },
            { name: "last", data: {}, runAt: new Date(60_000), priority: -2 },
          ]),
        );

        ok(failure instanceof ConnectionError);
        ok(failure.cause instanceof MongoBulkWriteError);

        expect({
          indices: failure.cause.result.getWriteErrors().map((error) => error.index),
          inserted: failure.cause.result.upsertedCount,
          matched: failure.cause.result.matchedCount,
          upsertedIndices: Object.keys(failure.cause.result.upsertedIds),
          notifications,
        }).toStrictEqual({
          indices: [1],
          inserted: 2,
          matched: 0,
          upsertedIndices: ["0", "2"],
          notifications: [
            ["first", new Date(0)],
            ["last", new Date(60_000)],
          ],
        });
      }).pipe(Effect.provide(fixture)),
  );
  effectIt.effect(
    "notifies a successful same-key input while retaining an unrelated native bulk failure",
    () =>
      Effect.gen(function* sameKeyPartialNotification() {
        const intake = yield* JobIntake;
        const { collection, notifications } = yield* IntakeFixture;
        yield* Effect.promise(
          async () =>
            await collection.createIndex({ "data.email": 1 }, { unique: true, sparse: true }),
        );
        yield* intake.enqueue("existing", { email: "taken" });
        notifications.length = 0;

        const failure = yield* Effect.flip(
          intake.enqueueMany([
            { name: "work", uniqueKey: "shared", data: { email: "taken" } },
            { name: "work", uniqueKey: "shared", data: { email: "free" }, runAt: new Date(60_000) },
          ]),
        );

        ok(failure instanceof ConnectionError);
        ok(failure.cause instanceof MongoBulkWriteError);
        expect({
          indices: failure.cause.result.getWriteErrors().map((error) => error.index),
          inserted: failure.cause.result.upsertedCount,
          matched: failure.cause.result.matchedCount,
          upsertedIndices: Object.keys(failure.cause.result.upsertedIds),
          notifications,
        }).toStrictEqual({
          indices: [0],
          inserted: 1,
          matched: 0,
          upsertedIndices: ["1"],
          notifications: [["work", new Date(60_000)]],
        });
      }).pipe(Effect.provide(fixture)),
  );
});
