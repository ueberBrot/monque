import { Effect, Exit, Fiber, Predicate, Scope } from "effect";
import type { ChangeStreamDocument } from "mongodb";

import { JobStatus } from "@/jobs";

import { fromPromise, observeTimerFailure } from "../effects.js";
import type { PendingNotificationSink } from "./pending-notification-router.js";
import type { SchedulerContext } from "./types.js";

type StreamDependencies = Pick<SchedulerContext, "collection" | "isRunning" | "emit">;

interface StreamLifetime {
  readonly scope: Scope.Closeable;
  attempts: number;
  cursor: CursorResource | null;
}

interface CursorResource {
  readonly scope: Scope.Closeable;
  active: boolean;
}

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
            { "updateDescription.updatedFields.priority": { $exists: true } },
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

/** Owns native cursors and reconnect resources; admission and polling live elsewhere. */
export class ChangeStreamHandler {
  private lifetime: StreamLifetime | null = null;
  private disposed = false;

  private readonly ctx: StreamDependencies;
  private readonly pendingNotifications: PendingNotificationSink;
  private readonly runFork: <A, E>(effect: Effect.Effect<A, E>) => Fiber.Fiber<A, E>;

  constructor(
    ctx: StreamDependencies,
    pendingNotifications: PendingNotificationSink,
    runFork: <A, E>(effect: Effect.Effect<A, E>) => Fiber.Fiber<A, E> = Effect.runFork,
  ) {
    this.ctx = ctx;
    this.pendingNotifications = pendingNotifications;
    this.runFork = runFork;
  }

  /** Synchronous Node callback boundary. Constructing the service never starts a cursor. */
  setup(): void {
    if (this.disposed || !this.ctx.isRunning()) {
      return;
    }

    const previous = this.lifetime;

    const lifetime: StreamLifetime = {
      scope: Scope.makeUnsafe("parallel"),
      attempts: 0,
      cursor: null,
    };

    // Publish the fence before closing: native close/listener hooks can reenter.
    this.lifetime = lifetime;

    if (previous) {
      this.runFork(Scope.close(previous.scope, Exit.void));
    }

    if (this.isCurrent(lifetime)) {
      this.open(lifetime);
    }
  }

  private isCurrent(lifetime: StreamLifetime, resource: CursorResource | null = null): boolean {
    return this.lifetime === lifetime && (resource === null || lifetime.cursor === resource);
  }

  private open(lifetime: StreamLifetime): void {
    const scope = Scope.forkUnsafe(lifetime.scope);
    let resource: CursorResource | null = null;

    try {
      const cursor = this.ctx.collection.watch(pipeline, { fullDocument: "updateLookup" });
      resource = { scope, active: false };
      const current = resource;

      const onToken = () => {
        // watch() is lazy; only a server response acknowledges recovery.
        if (this.isCurrent(lifetime, current)) {
          lifetime.attempts = 0;
        }
      };

      const onChange = (change: ChangeStreamDocument) => {
        if (this.isCurrent(lifetime, current)) {
          lifetime.attempts = 0;
          this.handleEvent(change);
        }
      };

      const onError = (error: Error) => {
        if (!this.isCurrent(lifetime, current)) {
          return;
        }

        this.ctx.emit("changestream:error", { error });

        if (this.isCurrent(lifetime, current)) {
          this.handleError(lifetime, current, error);
        }
      };

      const detachChanges = () => {
        cursor.removeListener("change", onChange);
        cursor.removeListener("resumeTokenChanged", onToken);
      };

      Effect.runSync(
        Scope.addFinalizer(
          scope,
          fromPromise(async () => {
            try {
              detachChanges();
            } finally {
              try {
                await cursor.close();
              } finally {
                // Closing emitters may still report errors until close settles.
                cursor.removeListener("error", onError);
              }
            }
          }).pipe(Effect.ignore),
        ),
      );

      if (!this.isCurrent(lifetime)) {
        this.runFork(Scope.close(scope, Exit.void));

        return;
      }

      lifetime.cursor = current;

      // Install the error listener before change starts MongoDB emitter mode.
      for (const attach of [
        () => cursor.on("error", onError),
        () => cursor.on("resumeTokenChanged", onToken),
        () => cursor.on("change", onChange),
      ]) {
        attach();

        if (!this.isCurrent(lifetime, current)) {
          // EventEmitter newListener runs before the new listener is added.
          detachChanges();

          return;
        }
      }

      current.active = true;
      this.pendingNotifications.setChangeStreamActive(true);

      if (this.isCurrent(lifetime, current)) {
        this.ctx.emit("changestream:connected", undefined);
      }
    } catch (error) {
      if (this.isCurrent(lifetime, resource)) {
        lifetime.cursor = null;
        this.pendingNotifications.setChangeStreamActive(false);
      }

      this.runFork(Scope.close(scope, Exit.void));
      const reason = error instanceof Error ? error.message : "Unknown error";
      this.ctx.emit("changestream:fallback", { reason });
    }
  }

  private handleEvent(change: ChangeStreamDocument): void {
    if (!this.ctx.isRunning()) {
      return;
    }

    // Trigger poll on insert (new job) or update where status changes
    const isInsert = change.operationType === "insert";
    const isUpdate = change.operationType === "update";
    // Get fullDocument if available (for insert or with updateLookup option)
    const fullDocument = "fullDocument" in change ? change.fullDocument : undefined;
    const currentStatus: unknown = fullDocument?.["status"];
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
      const rawName: unknown = fullDocument?.["name"];
      const jobName = Predicate.isString(rawName) ? rawName : undefined;
      this.pendingNotifications.notifyRunnableJob(jobName);

      return;
    }

    // Extract job metadata from the full document for smart routing
    const rawName: unknown = fullDocument?.["name"];
    const jobName = Predicate.isString(rawName) ? rawName : undefined;
    const rawNextRunAt: unknown = fullDocument?.["nextRunAt"];
    const nextRunAt = rawNextRunAt instanceof Date ? rawNextRunAt : undefined;

    if (jobName !== undefined && jobName.length > 0 && nextRunAt !== undefined) {
      this.pendingNotifications.notifyPendingJob(jobName, nextRunAt);

      return;
    }

    // Immediate job or missing metadata — collect for targeted/full poll
    this.pendingNotifications.notifyRunnableJob(jobName);
  }
  private handleError(lifetime: StreamLifetime, resource: CursorResource, error: Error): void {
    if (!this.ctx.isRunning()) {
      return;
    }

    lifetime.attempts += 1;
    lifetime.cursor = null;
    this.pendingNotifications.setChangeStreamActive(false);
    this.runFork(Scope.close(resource.scope, Exit.void));

    if (!this.isCurrent(lifetime) || !this.ctx.isRunning()) {
      return;
    }

    if (lifetime.attempts > 3) {
      this.ctx.emit("changestream:fallback", {
        reason: `Exhausted 3 reconnection attempts: ${error.message}`,
      });

      return;
    }

    const delay = 2 ** (lifetime.attempts - 1) * 1000;

    // The same lifetime owns backoff and its next cursor. Fiber.runIn removes
    // finished fibers; there is no separate timer scope or processing authority.
    const fiber = this.runFork(
      Effect.gen({ self: this }, function* reconnect() {
        yield* Effect.sleep(delay);

        if (this.isCurrent(lifetime) && this.ctx.isRunning()) {
          this.open(lifetime);
        }
      }),
    );

    Fiber.runIn(fiber, lifetime.scope);
    observeTimerFailure(fiber);
  }

  /** Restartable stream shutdown changes availability, never closes the router. */
  close = Effect.fnUntraced(function* closeChangeStream(this: ChangeStreamHandler) {
    const { lifetime } = this;
    this.lifetime = null;
    this.pendingNotifications.setChangeStreamActive(false);

    if (lifetime) {
      const wasActive = lifetime.cursor?.active === true;
      yield* Scope.close(lifetime.scope, Exit.void);

      if (wasActive) {
        this.ctx.emit("changestream:closed", undefined);
      }
    }
  });

  /** Initialized-instance release; ordinary stop remains restartable. */
  readonly dispose = Effect.suspend(() => {
    this.disposed = true;

    return this.close();
  });
}

export const makeChangeStreamHandler = Effect.fnUntraced(function* makeChangeStreamHandler(
  dependencies: StreamDependencies,
  notifications: PendingNotificationSink,
) {
  const context = yield* Effect.context();

  return yield* Effect.acquireRelease(
    Effect.sync(
      () => new ChangeStreamHandler(dependencies, notifications, Effect.runForkWith(context)),
    ),
    (streams) => streams.dispose,
  );
});
