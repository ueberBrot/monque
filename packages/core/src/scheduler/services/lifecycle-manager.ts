import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import { forEach as forEachEffect } from "effect/Effect";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import type { DeleteResult } from "mongodb";

import { JobStatus } from "@/jobs";
import { toError } from "@/shared";

import { fromPromise, observeBackgroundFailure } from "../effects.js";
import { JobLifecycle } from "./job-lifecycle.js";
import type { SchedulerContext } from "./types.js";

const monotonicFixed = (interval: number): Schedule.Schedule<number> =>
  Schedule.fromStep(
    Effect.gen(function* advanceMonotonicInterval() {
      const clock = yield* Clock.Clock;
      const step = yield* Schedule.toStep(Schedule.fixed(interval));
      return (_now: number, input: Parameters<typeof step>[1]) =>
        step(Number(clock.monotonicTimeNanosUnsafe()) / 1_000_000, input);
    }),
  );
/**
 * Default retention check interval (1 hour).
 */
const DEFAULT_RETENTION_INTERVAL = 3_600_000;
/**
 * Statuses covered by the completed/failed retention index.
 */
export const CLEANUP_STATUSES = [JobStatus.COMPLETED, JobStatus.FAILED] as const;
interface LifecycleTimers {
  heartbeat: Scope.Closeable | null;
  cleanup: Scope.Closeable | null;
}

/**
 * Manages scheduler lifecycle timers and job cleanup.
 *
 * Owns the heartbeat interval, cleanup interval, and the
 * cleanupJobs logic. Extracted from Monque to keep the facade thin.
 *
 * Not part of public API.
 * @internal
 */
export class LifecycleManager {
  private timers: LifecycleTimers = { heartbeat: null, cleanup: null };
  private heartbeatRunning = false;
  private readonly cleanupPermit = Semaphore.makeUnsafe(1);
  private readonly ctx: SchedulerContext;
  private readonly lifecycle;
  private readonly runFork: <A, E>(effect: Effect.Effect<A, E>) => Fiber.Fiber<A, E>;
  constructor(
    ctx: SchedulerContext,
    lifecycle = new JobLifecycle(ctx),
    runFork: <A, E>(effect: Effect.Effect<A, E>) => Fiber.Fiber<A, E> = Effect.runFork,
  ) {
    this.ctx = ctx;
    this.lifecycle = lifecycle;
    this.runFork = runFork;
  }
  /**
   * Start all lifecycle timers.
   *
   * Sets up the heartbeat interval and optional retention cleanup interval.
   */
  startTimers(): void {
    this.stopTimers();
    // Start heartbeat interval for claimed jobs
    const heartbeat = Effect.gen({ self: this }, function* runHeartbeatSchedule() {
      if (this.heartbeatRunning) {
        return;
      }
      this.heartbeatRunning = true;
      yield* Effect.gen({ self: this }, function* refreshOwnedHeartbeats() {
        yield* this.lifecycle.updateOwnedHeartbeats();
        if (
          this.ctx.isRunning() &&
          this.ctx.options.leaseDuration !== undefined &&
          this.ctx.options.recoverStaleJobs
        ) {
          yield* this.lifecycle.recoverStaleJobs();
        }
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.sync(() => {
            this.ctx.emit("job:error", { error: toError(Cause.squash(cause)) });
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            this.heartbeatRunning = false;
          }),
        ),
      );
    });
    const heartbeatScope = Scope.makeUnsafe();
    this.timers = { heartbeat: heartbeatScope, cleanup: null };
    Fiber.runIn(
      this.runFork(
        Effect.sleep(this.ctx.options.heartbeatInterval).pipe(
          Effect.andThen(
            Effect.forkDetach(heartbeat, { startImmediately: true, uninterruptible: true }).pipe(
              Effect.tap((fiber) => Effect.sync(() => observeBackgroundFailure(fiber))),
              Effect.repeat(monotonicFixed(this.ctx.options.heartbeatInterval)),
              Effect.asVoid,
            ),
          ),
        ),
      ),
      heartbeatScope,
    );
    // Start cleanup interval if retention is configured
    if (this.ctx.options.jobRetention) {
      const interval = this.ctx.options.jobRetention.interval ?? DEFAULT_RETENTION_INTERVAL;
      const cleanup = this.cleanupJobs().pipe(
        Effect.catchCause((cause) =>
          Effect.sync(() => {
            this.ctx.emit("job:error", { error: toError(Cause.squash(cause)) });
          }),
        ),
      );
      // Run immediately on start
      const cleanupScope = Scope.makeUnsafe();
      this.timers = { heartbeat: heartbeatScope, cleanup: cleanupScope };
      Fiber.runIn(
        this.runFork(
          Effect.forkDetach(cleanup, { startImmediately: true, uninterruptible: true }).pipe(
            Effect.tap((fiber) => Effect.sync(() => observeBackgroundFailure(fiber))),
            Effect.repeat(monotonicFixed(interval)),
            Effect.asVoid,
          ),
        ),
        cleanupScope,
      );
    }
  }
  /**
   * Stop all lifecycle timers.
   *
   * Clears heartbeat and cleanup intervals.
   */
  stopTimers(keepHeartbeat = false): void {
    const { timers } = this;
    this.timers = {
      heartbeat: keepHeartbeat ? timers.heartbeat : null,
      cleanup: null,
    };
    if (timers.cleanup) {
      this.runFork(Scope.close(timers.cleanup, Exit.void));
    }
    if (timers.heartbeat && !keepHeartbeat) {
      this.runFork(Scope.close(timers.heartbeat, Exit.void));
    }
  }
  /**
   * Clean up terminal jobs based on each status's configured retention period.
   *
   */
  cleanupJobs = Effect.fnUntraced(function* cleanExpiredJobs(
    this: LifecycleManager,
  ): Effect.fn.Return<void, unknown> {
    if (!this.ctx.options.jobRetention) {
      return;
    }
    const now = yield* Clock.currentTimeMillis;
    const deletions: Effect.Effect<DeleteResult, unknown>[] = [];
    for (const status of [...CLEANUP_STATUSES, JobStatus.CANCELLED]) {
      const age = this.ctx.options.jobRetention[status];
      if (age === null || age === undefined) {
        continue;
      }
      deletions.push(
        fromPromise(
          async () =>
            await this.ctx.collection.deleteMany({
              status,
              updatedAt: { $lt: new Date(now - age) },
            }),
        ),
      );
    }
    if (deletions.length > 0 && (yield* this.cleanupPermit.takeIfAvailable(1))) {
      const fibers = yield* forEachEffect(deletions, (deletion) =>
        Effect.forkDetach(deletion, { startImmediately: true, uninterruptible: true }),
      );
      yield* Effect.forkDetach(
        Fiber.awaitAll(fibers).pipe(Effect.andThen(this.cleanupPermit.release(1))),
        { startImmediately: true, uninterruptible: true },
      );
      yield* Fiber.joinAll(fibers);
    }
  }, Effect.uninterruptible);
}
