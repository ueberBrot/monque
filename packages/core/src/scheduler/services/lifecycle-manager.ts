import type { DeleteResult } from "mongodb";

import { JobStatus } from "@/jobs";
import { toError } from "@/shared";

import { JobLifecycle } from "./job-lifecycle.js";
import type { SchedulerContext } from "./types.js";

/**
 * Default retention check interval (1 hour).
 */
const DEFAULT_RETENTION_INTERVAL = 3600_000;

/**
 * Statuses covered by the completed/failed retention index.
 */
export const CLEANUP_STATUSES = [JobStatus.COMPLETED, JobStatus.FAILED] as const;

/**
 * Manages scheduler lifecycle timers and job cleanup.
 *
 * Owns the heartbeat interval, cleanup interval, and the
 * cleanupJobs logic. Extracted from Monque to keep the facade thin.
 *
 * @internal Not part of public API.
 */
export class LifecycleManager {
  private heartbeatIntervalId: ReturnType<typeof setInterval> | null = null;
  private cleanupIntervalId: ReturnType<typeof setInterval> | null = null;
  private heartbeatRunning = false;

  constructor(
    private readonly ctx: SchedulerContext,
    private readonly lifecycle = new JobLifecycle(ctx),
  ) {}

  /**
   * Start all lifecycle timers.
   *
   * Sets up the heartbeat interval and optional retention cleanup interval.
   */
  startTimers(): void {
    this.stopTimers();

    // Start heartbeat interval for claimed jobs
    this.heartbeatIntervalId = setInterval(async () => {
      if (this.heartbeatRunning) return;
      this.heartbeatRunning = true;
      try {
        await this.lifecycle.updateOwnedHeartbeats();
        if (
          this.ctx.isRunning() &&
          this.ctx.options.leaseDuration !== undefined &&
          this.ctx.options.recoverStaleJobs
        ) {
          await this.lifecycle.recoverStaleJobs();
        }
      } catch (error) {
        this.ctx.emit("job:error", { error: toError(error) });
      } finally {
        this.heartbeatRunning = false;
      }
    }, this.ctx.options.heartbeatInterval);

    // Start cleanup interval if retention is configured
    if (this.ctx.options.jobRetention) {
      const interval = this.ctx.options.jobRetention.interval ?? DEFAULT_RETENTION_INTERVAL;

      const cleanup = () =>
        this.cleanupJobs().catch((error: unknown) => {
          this.ctx.emit("job:error", { error: toError(error) });
        });

      // Run immediately on start
      cleanup();
      this.cleanupIntervalId = setInterval(cleanup, interval);
    }
  }

  /**
   * Stop all lifecycle timers.
   *
   * Clears heartbeat and cleanup intervals.
   */
  stopTimers(keepHeartbeat = false): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }

    if (this.heartbeatIntervalId && !keepHeartbeat) {
      clearInterval(this.heartbeatIntervalId);
      this.heartbeatIntervalId = null;
    }
  }

  /**
   * Clean up terminal jobs based on each status's configured retention period.
   *
   * @returns Promise resolving when all deletion operations complete
   */
  async cleanupJobs(): Promise<void> {
    if (!this.ctx.options.jobRetention) {
      return;
    }

    const now = Date.now();
    const deletions: Promise<DeleteResult>[] = [];

    for (const status of [...CLEANUP_STATUSES, JobStatus.CANCELLED]) {
      const age = this.ctx.options.jobRetention[status];
      if (age == null) continue;
      deletions.push(
        this.ctx.collection.deleteMany({
          status,
          updatedAt: { $lt: new Date(now - age) },
        }),
      );
    }

    if (deletions.length > 0) {
      await Promise.all(deletions);
    }
  }
}
