import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FiberHandle from "effect/FiberHandle";
import * as Scope from "effect/Scope";
import type { ChangeStream, ChangeStreamDocument, Document } from "mongodb";

import { JobStatus } from "@/jobs";

import { attempt, fromPromise, observeTimerFailure } from "../effects.js";
import type { PendingNotificationRouter } from "./pending-notification-router.js";
import type { SchedulerContext } from "./types.js";

/**
 * Internal service for MongoDB Change Stream lifecycle.
 *
 * Provides real-time job notifications when available, with automatic
 * reconnection and graceful fallback to polling-only mode.
 *
 * Leverages the full document from change stream events to:
 * - Trigger **targeted polls** for specific workers (using the job `name`)
 * - Schedule **precise wakeup timers** for future-dated jobs (using `nextRunAt`)
 *
 * @internal Not part of public API.
 */
export class ChangeStreamHandler {
  /** MongoDB Change Stream for real-time job notifications */
  private changeStream: {
    cursor: ChangeStream;
    scope: Scope.Closeable;
  } | null = null;

  /** Number of consecutive reconnection attempts */
  private reconnectAttempts = 0;

  /** Maximum reconnection attempts before falling back to polling-only mode */
  private readonly maxReconnectAttempts = 3;

  /** Timer ID for reconnection with exponential backoff */
  private reconnectTimer: {
    scope: Scope.Closeable;
    handle: FiberHandle.FiberHandle<void>;
  } | null = null;

  /** Whether the scheduler is currently using change streams */
  private usingChangeStreams = false;

  constructor(
    private readonly ctx: SchedulerContext,
    private readonly pendingNotifications: PendingNotificationRouter,
    private readonly runFork: <A, E>(
      effect: Effect.Effect<A, E>,
    ) => Fiber.Fiber<A, E> = Effect.runFork,
  ) {}

  /**
   * Set up MongoDB Change Stream for real-time job notifications.
   *
   * Change streams provide instant notifications when jobs are inserted or when
   * job status changes to pending (e.g., after a retry). This eliminates the
   * polling delay for reactive job processing.
   *
   * The change stream watches for:
   * - Insert operations (new jobs)
   * - Update operations where status field changes
   *
   * If change streams are unavailable (e.g., standalone MongoDB), the system
   * gracefully falls back to polling-only mode.
   */
  setup(): void {
    if (!this.ctx.isRunning()) {
      return;
    }

    this.clearReconnectTimer();
    const scope = Scope.makeUnsafe();

    try {
      // Create change stream with pipeline to filter relevant events
      const pipeline = [
        {
          $match: {
            $or: [
              { operationType: "insert" },
              {
                operationType: "update",
                $or: [
                  {
                    "updateDescription.updatedFields.status": {
                      $in: [JobStatus.PENDING, JobStatus.COMPLETED, JobStatus.FAILED],
                    },
                  },
                  { "updateDescription.updatedFields.nextRunAt": { $exists: true } },
                ],
              },
            ],
          },
        },
        {
          $project: {
            _id: 1,
            operationType: 1,
            "fullDocument.name": 1,
            "fullDocument.status": 1,
            "fullDocument.nextRunAt": 1,
            "updateDescription.updatedFields.status": 1,
            "updateDescription.updatedFields.nextRunAt": 1,
          },
        },
      ];

      const changeStream = Effect.runSync(
        Effect.acquireRelease(
          attempt(() => this.ctx.collection.watch(pipeline, { fullDocument: "updateLookup" })),
          (cursor) => fromPromise(() => cursor.close()).pipe(Effect.ignore),
        ).pipe(Effect.provideService(Scope.Scope, scope)),
      );
      this.changeStream = { cursor: changeStream, scope };

      // watch() is lazy: a token or change confirms a successful server response.
      changeStream.on("resumeTokenChanged", () => {
        if (this.changeStream?.cursor === changeStream) {
          this.reconnectAttempts = 0;
        }
      });

      // Handle change events
      changeStream.on("change", (change) => {
        if (this.changeStream?.cursor !== changeStream) return;
        this.reconnectAttempts = 0;
        this.handleEvent(change);
      });

      // Handle errors with reconnection
      changeStream.on("error", (error: Error) => {
        if (this.changeStream?.cursor !== changeStream) return;
        this.ctx.emit("changestream:error", { error });
        if (this.changeStream?.cursor === changeStream) this.handleError(error);
      });

      // Mark as connected
      this.usingChangeStreams = true;
      this.pendingNotifications.setChangeStreamActive(true);
      this.ctx.emit("changestream:connected", undefined);
    } catch (error) {
      // Change streams not available (e.g., standalone MongoDB)
      if (this.changeStream?.scope === scope) this.changeStream = null;
      if (!this.changeStream) this.resetActiveState();
      this.runFork(Scope.close(scope, Exit.void));
      const reason = error instanceof Error ? error.message : "Unknown error";
      this.ctx.emit("changestream:fallback", { reason });
    }
  }

  /**
   * Handle a change stream event using the full document for intelligent routing.
   *
   * For **immediate jobs** (`nextRunAt <= now`): collects the job name and triggers
   * a debounced targeted poll for only the relevant workers.
   *
   * For **future jobs** (`nextRunAt > now`): schedules a precise wakeup timer so
   * the job is picked up near its scheduled time without blind polling.
   *
   * For **completed/failed jobs** (slot freed): triggers a targeted re-poll for that
   * worker so the next pending job is picked up immediately, maintaining continuous
   * throughput without waiting for the safety poll interval.
   *
   * Falls back to a full poll (no target names) if the document is missing
   * required fields.
   *
   * @param change - The change stream event document
   */
  private handleEvent(change: ChangeStreamDocument<Document>): void {
    if (!this.ctx.isRunning()) {
      return;
    }

    // Trigger poll on insert (new job) or update where status changes
    const isInsert = change.operationType === "insert";
    const isUpdate = change.operationType === "update";

    // Get fullDocument if available (for insert or with updateLookup option)
    const fullDocument = "fullDocument" in change ? change.fullDocument : undefined;
    const currentStatus = fullDocument?.["status"] as string | undefined;
    const isPendingStatus = currentStatus === JobStatus.PENDING;

    // A completed/failed status change means a concurrency slot was freed.
    // Trigger a re-poll so the next pending job is picked up immediately,
    // rather than waiting for the safety poll interval.
    const isSlotFreed =
      isUpdate && (currentStatus === JobStatus.COMPLETED || currentStatus === JobStatus.FAILED);

    // For inserts: always trigger since new pending jobs need processing
    // For updates to pending: trigger (retry/release/recurring reschedule)
    // For updates to completed/failed: trigger (concurrency slot freed)
    const shouldTrigger = isInsert || (isUpdate && isPendingStatus) || isSlotFreed;

    if (!shouldTrigger) {
      return;
    }

    // Slot-freed events: targeted poll for that worker to pick up waiting jobs
    if (isSlotFreed) {
      const jobName = fullDocument?.["name"] as string | undefined;
      this.pendingNotifications.notifyRunnableJob(jobName);
      return;
    }

    // Extract job metadata from the full document for smart routing
    const jobName = fullDocument?.["name"] as string | undefined;
    const nextRunAt = fullDocument?.["nextRunAt"] as Date | undefined;

    if (jobName && nextRunAt) {
      this.pendingNotifications.notifyPendingJob(jobName, nextRunAt);
      return;
    }

    // Immediate job or missing metadata — collect for targeted/full poll
    this.pendingNotifications.notifyRunnableJob(jobName);
  }

  /**
   * Handle change stream errors with exponential backoff reconnection.
   *
   * Attempts to reconnect up to `maxReconnectAttempts` times with
   * exponential backoff (base 1000ms). After exhausting retries, falls back to
   * polling-only mode.
   *
   * @param error - The error that caused the change stream failure
   */
  private handleError(error: Error): void {
    if (!this.ctx.isRunning()) {
      return;
    }

    this.reconnectAttempts++;

    // Reset stream state without discarding shared Pending Notifications.
    this.resetActiveState();
    this.closeChangeStream();

    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      // Permanent fallback to polling-only mode
      this.clearReconnectTimer();

      this.ctx.emit("changestream:fallback", {
        reason: `Exhausted ${this.maxReconnectAttempts} reconnection attempts: ${error.message}`,
      });

      return;
    }

    // Exponential backoff: 1s, 2s, 4s
    const delay = 2 ** (this.reconnectAttempts - 1) * 1000;

    // Clear any existing reconnect timer before scheduling a new one
    this.clearReconnectTimer();

    if (!this.ctx.isRunning()) {
      return;
    }

    const scope = Scope.makeUnsafe();
    const handle = Effect.runSync(
      FiberHandle.make<void>().pipe(Effect.provideService(Scope.Scope, scope)),
    );
    this.reconnectTimer = { scope, handle };
    const fiber = this.runFork(
      Effect.gen({ self: this }, function* () {
        yield* Effect.sleep(delay);
        if (this.reconnectTimer?.handle !== handle) return;
        this.reconnectTimer = null;
        this.reconnect();
      }),
    );
    FiberHandle.setUnsafe(handle, fiber);
    fiber.addObserver(() => this.runFork(Scope.close(scope, Exit.void)));
    observeTimerFailure(fiber);
  }

  private reconnect(): void {
    if (!this.ctx.isRunning()) {
      return;
    }

    this.closeChangeStream();

    this.setup();
  }

  private clearReconnectTimer(): void {
    const timer = this.reconnectTimer;
    if (!timer) {
      return;
    }

    this.reconnectTimer = null;
    this.runFork(Scope.close(timer.scope, Exit.void));
  }

  /**
   * Mark the change stream inactive; scheduling belongs to the notification router.
   *
   * Does NOT close the cursor (callers handle sync vs async close) or clear
   * the reconnect timer/attempts (callers manage reconnection lifecycle).
   */
  private resetActiveState(): void {
    this.usingChangeStreams = false;
    this.pendingNotifications.setChangeStreamActive(false);
  }

  private closeChangeStream(): void {
    const changeStream = this.changeStream;
    this.changeStream = null;
    if (changeStream) {
      this.runFork(Scope.close(changeStream.scope, Exit.void));
    }
  }

  /**
   * Close the change stream cursor and emit closed event.
   */
  close = Effect.fnUntraced(function* (this: ChangeStreamHandler): Effect.fn.Return<void, unknown> {
    const wasActive = this.usingChangeStreams;
    const changeStream = this.changeStream;
    this.changeStream = null;
    this.reconnectAttempts = 0;

    // Stop stream delivery and reconnection.
    this.resetActiveState();
    this.clearReconnectTimer();

    if (changeStream) {
      // Ignore close errors during shutdown
      yield* Scope.close(changeStream.scope, Exit.void);

      if (wasActive) {
        this.ctx.emit("changestream:closed", undefined);
      }
    }
  });
}
