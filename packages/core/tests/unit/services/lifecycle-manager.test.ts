/**
 * Unit tests for LifecycleManager service.
 *
 * Tests timer setup/teardown, cleanup logic, and error emission.
 */
import { it as effectIt } from "@effect/vitest";
import { Clock, Effect } from "effect";
import { map as mapEffect } from "effect/Effect";
import { TestClock } from "effect/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { JobStatus } from "@/jobs";
import { LifecycleManager } from "@/scheduler/services/lifecycle-manager.js";
import { createMockContext, createWorker, JobFactoryHelpers } from "@tests/factories";
import { clockWithWallTime } from "@tests/setup/clock.js";
import { anyMatcher, anythingMatcher, objectContainingMatcher } from "@tests/setup/matchers.js";

const readMonotonicNanos = (): bigint => BigInt(Math.round(performance.now() * 1_000_000));

const writeResult = {
  acknowledged: true,
  matchedCount: 1,
  modifiedCount: 0,
  upsertedCount: 0,
  upsertedId: null,
};
describe(LifecycleManager, () => {
  let ctx: ReturnType<typeof createMockContext>;
  let manager: LifecycleManager;
  beforeEach(() => {
    ctx = createMockContext();
    manager = new LifecycleManager(ctx);
    const job = JobFactoryHelpers.processing({ claimId: "owned-claim" });
    ctx.workers.set(job.name, createWorker({ activeJobs: new Map([["owned-claim", job]]) }));
    vi.mocked(ctx.mockCollection.updateMany).mockResolvedValue(writeResult);
  });
  afterEach(() => {
    manager.stopTimers();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  describe("startTimers", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.spyOn(Effect.runSync(Clock.Clock), "monotonicTimeNanosUnsafe").mockImplementation(
        readMonotonicNanos,
      );
    });

    it("replaces retained heartbeat and cleanup timers without duplicate writes", async () => {
      ctx.options.jobRetention = { completed: 60_000, interval: ctx.options.heartbeatInterval };
      const cleanup = vi.spyOn(ctx.mockCollection, "deleteMany").mockResolvedValue({
        acknowledged: true,
        deletedCount: 0,
      });
      manager.startTimers();
      manager.stopTimers(true);
      manager.startTimers();
      manager.startTimers();
      cleanup.mockClear();
      await vi.advanceTimersByTimeAsync(ctx.options.heartbeatInterval);
      expect({
        collectionUpdateManyMockCallsLength: ctx.mockCollection.updateMany.mock.calls.length,
        cleanupMockCallsLength: cleanup.mock.calls.length,
        getTimerCount: vi.getTimerCount(),
      }).toStrictEqual({
        collectionUpdateManyMockCallsLength: 1,
        cleanupMockCallsLength: 1,
        getTimerCount: 2,
      });
      manager.stopTimers();
      await vi.advanceTimersByTimeAsync(ctx.options.heartbeatInterval);
      expect({
        collectionUpdateManyMockCallsLength: ctx.mockCollection.updateMany.mock.calls.length,
        cleanupMockCallsLength: cleanup.mock.calls.length,
        getTimerCount: vi.getTimerCount(),
      }).toStrictEqual({
        collectionUpdateManyMockCallsLength: 1,
        cleanupMockCallsLength: 1,
        getTimerCount: 0,
      });
    });

    it("should set up heartbeat interval", async () => {
      manager.startTimers();
      // Advance by one heartbeat interval
      await vi.advanceTimersByTimeAsync(ctx.options.heartbeatInterval);
      expect(ctx.mockCollection.updateMany).toHaveBeenCalledExactlyOnceWith(
        {
          claimedBy: ctx.instanceId,
          claimId: { $in: ["owned-claim"] },
          status: JobStatus.PROCESSING,
        },
        { $set: { lastHeartbeat: anyMatcher(Date), updatedAt: anyMatcher(Date) } },
      );
    });

    it("waits for in-flight heartbeat maintenance before starting another call", async () => {
      const pending = Promise.withResolvers<typeof writeResult>();
      vi.mocked(ctx.mockCollection.updateMany).mockReturnValueOnce(pending.promise);
      manager.startTimers();
      await vi.advanceTimersByTimeAsync(ctx.options.heartbeatInterval * 5);
      expect(ctx.mockCollection.updateMany).toHaveBeenCalledOnce();
      pending.resolve(writeResult);
      await vi.advanceTimersByTimeAsync(ctx.options.heartbeatInterval);
      expect(ctx.mockCollection.updateMany).toHaveBeenCalledTimes(2);
    });

    it("renews owned leases before recovering stale jobs and waits for both operations", async () => {
      ctx.options.leaseDuration = 3000;
      const heartbeat = Promise.withResolvers<typeof writeResult>();
      const recovery = Promise.withResolvers<typeof writeResult>();
      vi.mocked(ctx.mockCollection.updateMany)
        .mockReturnValueOnce(heartbeat.promise)
        .mockReturnValueOnce(recovery.promise);
      manager.startTimers();
      await vi.advanceTimersByTimeAsync(ctx.options.heartbeatInterval * 5);
      expect(ctx.mockCollection.updateMany).toHaveBeenCalledOnce();
      heartbeat.resolve(writeResult);
      await vi.advanceTimersByTimeAsync(ctx.options.heartbeatInterval * 5);
      expect({
        callCount: ctx.mockCollection.updateMany.mock.calls.length,
        operations: ctx.mockCollection.updateMany.mock.calls.slice(0, 2),
      }).toStrictEqual({
        callCount: 2,
        operations: [
          [
            objectContainingMatcher({ claimId: { $in: ["owned-claim"] } }),
            [{ $set: objectContainingMatcher({ leaseExpiresAt: { $add: ["$$NOW", 3000] } }) }],
          ],
          [
            objectContainingMatcher({ $or: anyMatcher(Array) }),
            objectContainingMatcher({
              $set: objectContainingMatcher({ status: JobStatus.PENDING }),
            }),
          ],
        ],
      });
      recovery.resolve({ ...writeResult, modifiedCount: 2 });
      await vi.advanceTimersByTimeAsync(ctx.options.heartbeatInterval);
      expect(ctx.mockCollection.updateMany).toHaveBeenCalledTimes(4);
      expect(ctx.emitHistory).toContainEqual({ event: "stale:recovered", payload: { count: 2 } });
      expect(ctx.notifyPendingJob).toHaveBeenCalledWith(undefined, anyMatcher(Date));
    });

    it("keeps renewing leases after stopping during a heartbeat without recovering stale jobs", async () => {
      ctx.options.leaseDuration = 3000;
      const heartbeat = Promise.withResolvers<typeof writeResult>();
      vi.mocked(ctx.mockCollection.updateMany).mockReturnValueOnce(heartbeat.promise);
      manager.startTimers();
      await vi.advanceTimersByTimeAsync(ctx.options.heartbeatInterval);
      manager.stopTimers(true);
      vi.mocked(ctx.isRunning).mockReturnValue(false);
      heartbeat.resolve(writeResult);
      await vi.advanceTimersByTimeAsync(ctx.options.heartbeatInterval);
      expect(ctx.mockCollection.updateMany).toHaveBeenCalledTimes(2);
      expect(ctx.mockCollection.updateMany).toHaveBeenCalledWith(
        objectContainingMatcher({ claimId: { $in: ["owned-claim"] } }),
        anyMatcher(Array),
      );
      expect(ctx.mockCollection.updateMany).not.toHaveBeenCalledWith(
        objectContainingMatcher({ $or: anyMatcher(Array) }),
        anythingMatcher(),
      );
    });

    it("skips stale recovery when recovery is disabled", async () => {
      ctx.options.leaseDuration = 3000;
      ctx.options.recoverStaleJobs = false;
      manager.startTimers();
      await vi.advanceTimersByTimeAsync(ctx.options.heartbeatInterval);
      expect(ctx.mockCollection.updateMany).toHaveBeenCalledOnce();
    });

    it("emits recovery errors and allows the next maintenance interval to run", async () => {
      ctx.options.leaseDuration = 3000;
      const recoveryError = new Error("Recovery failed");
      vi.mocked(ctx.mockCollection.updateMany)
        .mockResolvedValueOnce(writeResult)
        .mockRejectedValueOnce(recoveryError);
      manager.startTimers();
      await vi.advanceTimersByTimeAsync(ctx.options.heartbeatInterval);
      expect(ctx.emitHistory).toContainEqual({
        event: "job:error",
        payload: { error: recoveryError },
      });
      await vi.advanceTimersByTimeAsync(ctx.options.heartbeatInterval);
      expect(ctx.mockCollection.updateMany).toHaveBeenCalledTimes(4);
    });

    it("should set up cleanup interval when jobRetention is configured", () => {
      ctx.options.jobRetention = { completed: 60_000, failed: 120_000 };
      manager = new LifecycleManager(ctx);
      vi.spyOn(ctx.mockCollection, "deleteMany").mockResolvedValue({
        acknowledged: true,
        deletedCount: 0,
      });
      manager.startTimers();
      // cleanupJobs should run immediately on start
      expect(vi.mocked(ctx.mockCollection.deleteMany).mock.calls.length).toBeGreaterThan(0);
    });

    it("should run cleanup on interval when jobRetention is configured", async () => {
      const retentionInterval = 5000;
      ctx.options.jobRetention = {
        completed: 60_000,
        failed: 120_000,
        interval: retentionInterval,
      };
      manager = new LifecycleManager(ctx);
      vi.spyOn(ctx.mockCollection, "deleteMany").mockResolvedValue({
        acknowledged: true,
        deletedCount: 0,
      });
      manager.startTimers();
      // Clear the immediate call
      vi.mocked(ctx.mockCollection.deleteMany).mockClear();
      // Advance by the retention interval
      await vi.advanceTimersByTimeAsync(retentionInterval);
      expect(vi.mocked(ctx.mockCollection.deleteMany).mock.calls.length).toBeGreaterThan(0);
    });

    it("should skip cleanup when no jobRetention is configured", async () => {
      // Default ctx has no jobRetention — spy must be in place before
      // startTimers so any immediate cleanup call would be observed.
      vi.spyOn(ctx.mockCollection, "deleteMany");
      manager.startTimers();
      await vi.advanceTimersByTimeAsync(10_000);
      // With no jobRetention, cleanupJobs is never called
      expect(ctx.mockCollection.deleteMany).not.toHaveBeenCalled();
    });

    it("emits job:error and retries on the next interval when heartbeat updates reject", async () => {
      const heartbeatError = new Error("Heartbeat failed");
      vi.mocked(ctx.mockCollection.updateMany).mockRejectedValueOnce(heartbeatError);
      manager.startTimers();
      // Advance past one heartbeat interval
      await vi.advanceTimersByTimeAsync(ctx.options.heartbeatInterval);
      expect(ctx.emitHistory).toContainEqual(
        objectContainingMatcher({
          event: "job:error",
          payload: objectContainingMatcher({ error: heartbeatError }),
        }),
      );
      await vi.advanceTimersByTimeAsync(ctx.options.heartbeatInterval);
      expect(ctx.mockCollection.updateMany).toHaveBeenCalledTimes(2);
    });

    it("should emit job:error when initial cleanupJobs rejects", async () => {
      ctx.options.jobRetention = { completed: 60_000, failed: 120_000 };
      manager = new LifecycleManager(ctx);
      const cleanupError = new Error("Cleanup failed");
      vi.spyOn(ctx.mockCollection, "deleteMany").mockRejectedValue(cleanupError);
      manager.startTimers();
      // Wait for the initial cleanupJobs rejection to be handled
      await vi.advanceTimersByTimeAsync(0);
      expect(ctx.emitHistory).toContainEqual(
        objectContainingMatcher({
          event: "job:error",
          payload: objectContainingMatcher({ error: cleanupError }),
        }),
      );
    });

    it("should emit job:error when interval cleanupJobs rejects", async () => {
      const retentionInterval = 5000;
      ctx.options.jobRetention = {
        completed: 60_000,
        failed: 120_000,
        interval: retentionInterval,
      };
      manager = new LifecycleManager(ctx);
      const cleanupError = new Error("Cleanup failed");
      vi.spyOn(ctx.mockCollection, "deleteMany")
        .mockResolvedValueOnce({ acknowledged: true, deletedCount: 0 })
        .mockRejectedValueOnce(cleanupError);
      manager.startTimers();
      // Advance by the retention interval to trigger the failing cleanup
      await vi.advanceTimersByTimeAsync(retentionInterval);
      expect(ctx.emitHistory).toContainEqual(
        objectContainingMatcher({
          event: "job:error",
          payload: objectContainingMatcher({ error: cleanupError }),
        }),
      );
    });
  });
  describe("stopTimers", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.spyOn(Effect.runSync(Clock.Clock), "monotonicTimeNanosUnsafe").mockImplementation(
        readMonotonicNanos,
      );
    });

    it("should clear all intervals so callbacks stop firing", async () => {
      manager.startTimers();
      // Clear initial call counts
      vi.mocked(ctx.mockCollection.updateMany).mockClear();
      manager.stopTimers();
      // Advance time — no callbacks should fire
      await vi.advanceTimersByTimeAsync(ctx.options.pollInterval * 5);
      await vi.advanceTimersByTimeAsync(ctx.options.heartbeatInterval * 5);
      expect(ctx.mockCollection.updateMany).not.toHaveBeenCalled();
    });

    it("should be safe to call multiple times", () => {
      manager.startTimers();
      expect(() => {
        manager.stopTimers();
        manager.stopTimers();
      }).not.toThrow();
    });
  });
  effectIt.effect("skips retention ticks until the previous cleanup settles across restart", () =>
    Effect.gen(function* effectWorkflow1() {
      const context = yield* Effect.context();
      ctx.options.jobRetention = { completed: 60_000, interval: 1000 };
      const result = { acknowledged: true, deletedCount: 0 };
      const pending = Promise.withResolvers<typeof result>();
      const deletion = vi
        .mocked(ctx.mockCollection.deleteMany)
        .mockResolvedValue(result)
        .mockReturnValueOnce(pending.promise);
      manager = new LifecycleManager(ctx, undefined, Effect.runForkWith(context));
      try {
        manager.startTimers();
        yield* TestClock.adjust(5000);
        expect(deletion).toHaveBeenCalledOnce();
        manager.stopTimers();
        manager.startTimers();
        yield* TestClock.adjust(2000);
        expect(deletion).toHaveBeenCalledOnce();
        pending.resolve(result);
        yield* TestClock.adjust(1000);
        expect(deletion).toHaveBeenCalledTimes(2);
        manager.stopTimers();
        yield* TestClock.adjust(5000);
        expect(deletion).toHaveBeenCalledTimes(2);
      } finally {
        pending.resolve(result);
        manager.stopTimers();
      }
    }),
  );
  effectIt.effect.each([false, true])(
    "keeps retention single-flight after an early failure until its sibling settles, sibling rejects: %s",
    (siblingRejects) =>
      Effect.gen(function* effectWorkflow2() {
        const context = yield* Effect.context();
        ctx.options.jobRetention = { completed: 60_000, failed: 120_000, interval: 1000 };
        const result = { acknowledged: true, deletedCount: 0 };
        const pending = Promise.withResolvers<typeof result>();
        const error = new Error("Completed retention failed");
        const deletion = vi
          .mocked(ctx.mockCollection.deleteMany)
          .mockResolvedValue(result)
          .mockRejectedValueOnce(error)
          .mockReturnValueOnce(pending.promise);
        manager = new LifecycleManager(ctx, undefined, Effect.runForkWith(context));
        try {
          manager.startTimers();
          yield* TestClock.adjust(0);
          expect(ctx.emitHistory).toStrictEqual([{ event: "job:error", payload: { error } }]);
          yield* TestClock.adjust(5000);
          expect(deletion).toHaveBeenCalledTimes(2);
          manager.stopTimers();
          manager.startTimers();
          yield* TestClock.adjust(1000);
          expect(deletion).toHaveBeenCalledTimes(2);
          if (siblingRejects) {
            pending.reject(new Error("Failed retention failed"));
          } else {
            pending.resolve(result);
          }
          yield* TestClock.adjust(1000);
          expect({
            deletionMockCallsLength: deletion.mock.calls.length,
            emitHistoryLength: ctx.emitHistory.length,
          }).toStrictEqual({
            deletionMockCallsLength: 4,
            emitHistoryLength: 1,
          });
        } finally {
          pending.resolve(result);
          manager.stopTimers();
        }
      }),
  );
  effectIt.effect.each([-1500, 1500])(
    "keeps heartbeat and retention cadence when wall time shifts by %i ms",
    (shift) =>
      Effect.gen(function* effectWorkflow3() {
        const testClock = yield* TestClock.testClockWith(Effect.succeed);
        const clock = yield* Clock.Clock;
        let offset = 60_000;
        yield* Effect.gen(function* effectWorkflow4() {
          const context = yield* Effect.context();
          ctx.options.heartbeatInterval = 1000;
          ctx.options.leaseDuration = 1100;
          ctx.options.recoverStaleJobs = false;
          ctx.options.jobRetention = { completed: 10_000, interval: 1000 };
          const deletion = vi.mocked(ctx.mockCollection.deleteMany).mockResolvedValue({
            acknowledged: true,
            deletedCount: 0,
          });
          manager = new LifecycleManager(ctx, undefined, Effect.runForkWith(context));
          try {
            manager.startTimers();
            yield* testClock.adjust(1000);
            expect({
              collectionUpdateManyMockCallsLength: ctx.mockCollection.updateMany.mock.calls.length,
              deletionMockCallsLength: deletion.mock.calls.length,
            }).toStrictEqual({
              collectionUpdateManyMockCallsLength: 1,
              deletionMockCallsLength: 2,
            });
            offset += shift;
            for (let tick = 2; tick <= 4; tick += 1) {
              yield* testClock.adjust(999);
              expect({
                collectionUpdateManyMockCallsLength:
                  ctx.mockCollection.updateMany.mock.calls.length,
                deletionMockCallsLength: deletion.mock.calls.length,
              }).toStrictEqual({
                collectionUpdateManyMockCallsLength: tick - 1,
                deletionMockCallsLength: tick,
              });
              yield* testClock.adjust(1);
              expect({
                collectionUpdateManyMockCallsLength:
                  ctx.mockCollection.updateMany.mock.calls.length,
                deletionMockCallsLength: deletion.mock.calls.length,
              }).toStrictEqual({
                collectionUpdateManyMockCallsLength: tick,
                deletionMockCallsLength: tick + 1,
              });
            }
            expect(deletion).toHaveBeenLastCalledWith({
              status: JobStatus.COMPLETED,
              updatedAt: { $lt: new Date(54_000 + shift) },
            });
          } finally {
            manager.stopTimers();
          }
        }).pipe(
          Effect.provideService(
            Clock.Clock,
            clockWithWallTime(
              clock,
              mapEffect(clock.currentTimeMillis, (now) => now + offset),
              () => clock.currentTimeMillisUnsafe() + offset,
            ),
          ),
        );
      }),
  );
  describe("cleanupJobs", () => {
    effectIt.effect.each([
      { status: JobStatus.COMPLETED, age: 60_000, cutoff: "2025-06-01T11:59:00.000Z" },
      { status: JobStatus.FAILED, age: 120_000, cutoff: "2025-06-01T11:58:00.000Z" },
      { status: JobStatus.CANCELLED, age: 180_000, cutoff: "2025-06-01T11:57:00.000Z" },
    ])("deletes $status jobs before the configured retention cutoff", ({ status, age, cutoff }) =>
      Effect.gen(function* effectWorkflow5() {
        ctx.options.jobRetention = { [status]: age };
        vi.mocked(ctx.mockCollection.deleteMany).mockResolvedValue({
          acknowledged: true,
          deletedCount: 3,
        });
        yield* TestClock.setTime(new Date("2025-06-01T12:00:00.000Z").getTime());
        yield* manager.cleanupJobs();
        expect(ctx.mockCollection.deleteMany).toHaveBeenCalledExactlyOnceWith({
          status,
          updatedAt: { $lt: new Date(cutoff) },
        });
      }),
    );
    effectIt.effect(
      "recalculates every terminal retention cutoff from the current Effect time",
      () =>
        Effect.gen(function* effectWorkflow6() {
          ctx.options.jobRetention = { completed: 60_000, failed: 120_000, cancelled: 180_000 };
          vi.mocked(ctx.mockCollection.deleteMany).mockResolvedValue({
            acknowledged: true,
            deletedCount: 0,
          });
          yield* TestClock.setTime(new Date("2025-06-01T12:00:00.000Z").getTime());
          yield* manager.cleanupJobs();
          vi.mocked(ctx.mockCollection.deleteMany).mockClear();
          yield* TestClock.setTime(new Date("2025-06-01T12:05:00.000Z").getTime());
          yield* manager.cleanupJobs();
          expect(ctx.mockCollection.deleteMany).toHaveBeenCalledTimes(3);
          expect(ctx.mockCollection.deleteMany).toHaveBeenCalledWith({
            status: JobStatus.COMPLETED,
            updatedAt: { $lt: new Date("2025-06-01T12:04:00.000Z") },
          });
          expect(ctx.mockCollection.deleteMany).toHaveBeenCalledWith({
            status: JobStatus.FAILED,
            updatedAt: { $lt: new Date("2025-06-01T12:03:00.000Z") },
          });
          expect(ctx.mockCollection.deleteMany).toHaveBeenCalledWith({
            status: JobStatus.CANCELLED,
            updatedAt: { $lt: new Date("2025-06-01T12:02:00.000Z") },
          });
        }),
    );
    effectIt.effect("does not delete jobs when retention is not configured", () =>
      Effect.gen(function* effectWorkflow7() {
        yield* manager.cleanupJobs();
        expect(ctx.mockCollection.deleteMany).not.toHaveBeenCalled();
      }),
    );
  });
});
