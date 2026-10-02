/**
 * Unit tests for LifecycleManager service.
 *
 * Tests timer setup/teardown, cleanup logic, and error emission.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { JobStatus } from "@/jobs";
import { LifecycleManager } from "@/scheduler/services/lifecycle-manager.js";
import { createMockContext, createWorker, JobFactoryHelpers } from "@tests/factories";

const writeResult = {
  acknowledged: true,
  matchedCount: 1,
  modifiedCount: 0,
  upsertedCount: 0,
  upsertedId: null,
};

describe("LifecycleManager", () => {
  let ctx: ReturnType<typeof createMockContext>;
  let manager: LifecycleManager;

  beforeEach(() => {
    vi.useFakeTimers();
    ctx = createMockContext();
    manager = new LifecycleManager(ctx);
    const job = JobFactoryHelpers.processing({ claimId: "owned-claim" });
    ctx.workers.set(job.name, createWorker({ activeJobs: new Map([["owned-claim", job]]) }));
    vi.mocked(ctx.collection.updateMany).mockResolvedValue(writeResult);
  });

  afterEach(() => {
    manager.stopTimers();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe("startTimers", () => {
    it("replaces retained heartbeat and cleanup timers without duplicate writes", async () => {
      ctx.options.jobRetention = { completed: 60000, interval: ctx.options.heartbeatInterval };
      const cleanup = vi.spyOn(ctx.collection, "deleteMany").mockResolvedValue({
        acknowledged: true,
        deletedCount: 0,
      });
      manager.startTimers();
      manager.stopTimers(true);
      manager.startTimers();
      manager.startTimers();
      cleanup.mockClear();

      await vi.advanceTimersByTimeAsync(ctx.options.heartbeatInterval);
      expect(ctx.collection.updateMany).toHaveBeenCalledOnce();
      expect(cleanup).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(2);

      manager.stopTimers();
      await vi.advanceTimersByTimeAsync(ctx.options.heartbeatInterval);
      expect(ctx.collection.updateMany).toHaveBeenCalledOnce();
      expect(cleanup).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("should set up heartbeat interval", async () => {
      manager.startTimers();

      // Advance by one heartbeat interval
      await vi.advanceTimersByTimeAsync(ctx.options.heartbeatInterval);

      expect(ctx.collection.updateMany).toHaveBeenCalledExactlyOnceWith(
        {
          claimedBy: ctx.instanceId,
          claimId: { $in: ["owned-claim"] },
          status: JobStatus.PROCESSING,
        },
        { $set: { lastHeartbeat: expect.any(Date), updatedAt: expect.any(Date) } },
      );
    });

    it("waits for in-flight heartbeat maintenance before starting another call", async () => {
      const pending = Promise.withResolvers<typeof writeResult>();
      vi.mocked(ctx.collection.updateMany).mockReturnValueOnce(pending.promise);
      manager.startTimers();
      await vi.advanceTimersByTimeAsync(ctx.options.heartbeatInterval * 5);
      expect(ctx.collection.updateMany).toHaveBeenCalledOnce();
      pending.resolve(writeResult);
      await vi.advanceTimersByTimeAsync(ctx.options.heartbeatInterval);
      expect(ctx.collection.updateMany).toHaveBeenCalledTimes(2);
    });

    it("renews owned leases before recovering stale jobs and waits for both operations", async () => {
      ctx.options.leaseDuration = 3000;
      const heartbeat = Promise.withResolvers<typeof writeResult>();
      const recovery = Promise.withResolvers<typeof writeResult>();
      vi.mocked(ctx.collection.updateMany)
        .mockReturnValueOnce(heartbeat.promise)
        .mockReturnValueOnce(recovery.promise);
      manager.startTimers();

      await vi.advanceTimersByTimeAsync(ctx.options.heartbeatInterval * 5);
      expect(ctx.collection.updateMany).toHaveBeenCalledOnce();
      heartbeat.resolve(writeResult);
      await vi.advanceTimersByTimeAsync(ctx.options.heartbeatInterval * 5);
      expect(ctx.collection.updateMany).toHaveBeenCalledTimes(2);
      expect(ctx.collection.updateMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ claimId: { $in: ["owned-claim"] } }),
        [{ $set: expect.objectContaining({ leaseExpiresAt: { $add: ["$$NOW", 3000] } }) }],
      );
      expect(ctx.collection.updateMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ $or: expect.any(Array) }),
        expect.objectContaining({ $set: expect.objectContaining({ status: JobStatus.PENDING }) }),
      );

      recovery.resolve({ ...writeResult, modifiedCount: 2 });
      await vi.advanceTimersByTimeAsync(ctx.options.heartbeatInterval);
      expect(ctx.collection.updateMany).toHaveBeenCalledTimes(4);
      expect(ctx.emitHistory).toContainEqual({ event: "stale:recovered", payload: { count: 2 } });
      expect(ctx.notifyPendingJob).toHaveBeenCalledWith(undefined, expect.any(Date));
    });

    it("keeps renewing leases after stopping during a heartbeat without recovering stale jobs", async () => {
      ctx.options.leaseDuration = 3000;
      const heartbeat = Promise.withResolvers<typeof writeResult>();
      vi.mocked(ctx.collection.updateMany).mockReturnValueOnce(heartbeat.promise);
      manager.startTimers();
      await vi.advanceTimersByTimeAsync(ctx.options.heartbeatInterval);
      manager.stopTimers(true);
      vi.mocked(ctx.isRunning).mockReturnValue(false);

      heartbeat.resolve(writeResult);
      await vi.advanceTimersByTimeAsync(ctx.options.heartbeatInterval);
      expect(ctx.collection.updateMany).toHaveBeenCalledTimes(2);
      expect(ctx.collection.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ claimId: { $in: ["owned-claim"] } }),
        expect.any(Array),
      );
      expect(ctx.collection.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({ $or: expect.any(Array) }),
        expect.anything(),
      );
    });

    it("skips stale recovery when recovery is disabled", async () => {
      ctx.options.leaseDuration = 3000;
      ctx.options.recoverStaleJobs = false;
      manager.startTimers();

      await vi.advanceTimersByTimeAsync(ctx.options.heartbeatInterval);
      expect(ctx.collection.updateMany).toHaveBeenCalledOnce();
    });

    it("emits recovery errors and allows the next maintenance interval to run", async () => {
      ctx.options.leaseDuration = 3000;
      const recoveryError = new Error("Recovery failed");
      vi.mocked(ctx.collection.updateMany)
        .mockResolvedValueOnce(writeResult)
        .mockRejectedValueOnce(recoveryError);
      manager.startTimers();

      await vi.advanceTimersByTimeAsync(ctx.options.heartbeatInterval);
      expect(ctx.emitHistory).toContainEqual({
        event: "job:error",
        payload: { error: recoveryError },
      });
      await vi.advanceTimersByTimeAsync(ctx.options.heartbeatInterval);
      expect(ctx.collection.updateMany).toHaveBeenCalledTimes(4);
    });

    it("should set up cleanup interval when jobRetention is configured", async () => {
      ctx.options.jobRetention = { completed: 60000, failed: 120000 };
      manager = new LifecycleManager(ctx);

      vi.spyOn(ctx.collection, "deleteMany").mockResolvedValue({
        acknowledged: true,
        deletedCount: 0,
      });

      manager.startTimers();

      // cleanupJobs should run immediately on start
      expect(ctx.collection.deleteMany).toHaveBeenCalled();
    });

    it("should run cleanup on interval when jobRetention is configured", async () => {
      const retentionInterval = 5000;
      ctx.options.jobRetention = {
        completed: 60000,
        failed: 120000,
        interval: retentionInterval,
      };
      manager = new LifecycleManager(ctx);

      vi.spyOn(ctx.collection, "deleteMany").mockResolvedValue({
        acknowledged: true,
        deletedCount: 0,
      });

      manager.startTimers();

      // Clear the immediate call
      vi.mocked(ctx.collection.deleteMany).mockClear();

      // Advance by the retention interval
      await vi.advanceTimersByTimeAsync(retentionInterval);

      expect(ctx.collection.deleteMany).toHaveBeenCalled();
    });

    it("should skip cleanup when no jobRetention is configured", async () => {
      // Default ctx has no jobRetention — spy must be in place before
      // startTimers so any immediate cleanup call would be observed.
      vi.spyOn(ctx.collection, "deleteMany");

      manager.startTimers();

      await vi.advanceTimersByTimeAsync(10000);

      // With no jobRetention, cleanupJobs is never called
      expect(ctx.collection.deleteMany).not.toHaveBeenCalled();
    });

    it("emits job:error and retries on the next interval when heartbeat updates reject", async () => {
      const heartbeatError = new Error("Heartbeat failed");
      vi.mocked(ctx.collection.updateMany).mockRejectedValueOnce(heartbeatError);

      manager.startTimers();

      // Advance past one heartbeat interval
      await vi.advanceTimersByTimeAsync(ctx.options.heartbeatInterval);

      expect(ctx.emitHistory).toContainEqual(
        expect.objectContaining({
          event: "job:error",
          payload: expect.objectContaining({ error: heartbeatError }),
        }),
      );
      await vi.advanceTimersByTimeAsync(ctx.options.heartbeatInterval);
      expect(ctx.collection.updateMany).toHaveBeenCalledTimes(2);
    });

    it("should emit job:error when initial cleanupJobs rejects", async () => {
      ctx.options.jobRetention = { completed: 60000, failed: 120000 };
      manager = new LifecycleManager(ctx);

      const cleanupError = new Error("Cleanup failed");
      vi.spyOn(ctx.collection, "deleteMany").mockRejectedValue(cleanupError);

      manager.startTimers();

      // Wait for the initial cleanupJobs rejection to be handled
      await vi.advanceTimersByTimeAsync(0);

      expect(ctx.emitHistory).toContainEqual(
        expect.objectContaining({
          event: "job:error",
          payload: expect.objectContaining({ error: cleanupError }),
        }),
      );
    });

    it("should emit job:error when interval cleanupJobs rejects", async () => {
      const retentionInterval = 5000;
      ctx.options.jobRetention = {
        completed: 60000,
        failed: 120000,
        interval: retentionInterval,
      };
      manager = new LifecycleManager(ctx);

      const cleanupError = new Error("Cleanup failed");
      vi.spyOn(ctx.collection, "deleteMany")
        .mockResolvedValueOnce({ acknowledged: true, deletedCount: 0 })
        .mockRejectedValueOnce(cleanupError);

      manager.startTimers();

      // Advance by the retention interval to trigger the failing cleanup
      await vi.advanceTimersByTimeAsync(retentionInterval);

      expect(ctx.emitHistory).toContainEqual(
        expect.objectContaining({
          event: "job:error",
          payload: expect.objectContaining({ error: cleanupError }),
        }),
      );
    });
  });

  describe("stopTimers", () => {
    it("should clear all intervals so callbacks stop firing", async () => {
      manager.startTimers();

      // Clear initial call counts
      vi.mocked(ctx.collection.updateMany).mockClear();

      manager.stopTimers();

      // Advance time — no callbacks should fire
      await vi.advanceTimersByTimeAsync(ctx.options.pollInterval * 5);
      await vi.advanceTimersByTimeAsync(ctx.options.heartbeatInterval * 5);

      expect(ctx.collection.updateMany).not.toHaveBeenCalled();
    });

    it("should be safe to call multiple times", () => {
      manager.startTimers();

      expect(() => {
        manager.stopTimers();
        manager.stopTimers();
      }).not.toThrow();
    });
  });

  describe("cleanupJobs", () => {
    it("should delete completed jobs older than retention", async () => {
      ctx.options.jobRetention = { completed: 60000 };
      manager = new LifecycleManager(ctx);

      vi.spyOn(ctx.collection, "deleteMany").mockResolvedValue({
        acknowledged: true,
        deletedCount: 5,
      });

      await manager.cleanupJobs();

      expect(ctx.collection.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          status: JobStatus.COMPLETED,
          updatedAt: expect.objectContaining({ $lt: expect.any(Date) }),
        }),
      );
    });

    it("should delete failed jobs older than retention", async () => {
      ctx.options.jobRetention = { failed: 120000 };
      manager = new LifecycleManager(ctx);

      vi.spyOn(ctx.collection, "deleteMany").mockResolvedValue({
        acknowledged: true,
        deletedCount: 3,
      });

      await manager.cleanupJobs();

      expect(ctx.collection.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          status: JobStatus.FAILED,
          updatedAt: expect.objectContaining({ $lt: expect.any(Date) }),
        }),
      );
    });

    it("should delete both completed and failed when both configured", async () => {
      ctx.options.jobRetention = { completed: 60000, failed: 120000 };
      manager = new LifecycleManager(ctx);

      vi.spyOn(ctx.collection, "deleteMany").mockResolvedValue({
        acknowledged: true,
        deletedCount: 0,
      });

      await manager.cleanupJobs();

      expect(ctx.collection.deleteMany).toHaveBeenCalledTimes(2);
    });

    it("should be a no-op when jobRetention is not configured", async () => {
      // Default ctx has no jobRetention
      vi.spyOn(ctx.collection, "deleteMany");

      await manager.cleanupJobs();

      expect(ctx.collection.deleteMany).not.toHaveBeenCalled();
    });
  });
});
