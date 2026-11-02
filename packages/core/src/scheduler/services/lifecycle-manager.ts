import { Cause, Clock, Effect, Exit, Fiber, Schedule, Scope, Semaphore } from "effect";
import { forEach as forEachEffect } from "effect/Effect";
import type { Collection } from "mongodb";

import type { MonqueEventMap } from "@/events";
import { JobStatus } from "@/jobs";
import { toError } from "@/shared";

import { attempt, observeBackgroundFailure } from "../effects.js";
import type { JobOwnership } from "./job-ownership.js";
import { JobPersistenceError } from "./job-persistence-error.js";
import type { ResolvedMonqueOptions } from "./types.js";

const monotonicFixed = (interval: number): Schedule.Schedule<number> =>
  Schedule.fromStep(
    Effect.gen(function* advanceMonotonicInterval() {
      const clock = yield* Clock.Clock;
      const step = yield* Schedule.toStep(Schedule.fixed(interval));

      return (_now: number, input: Parameters<typeof step>[1]) =>
        step(Number(clock.monotonicTimeNanosUnsafe()) / 1_000_000, input);
    }),
  );

const DEFAULT_RETENTION_INTERVAL = 3_600_000;

/** Statuses covered by the completed/failed retention index. */
export const CLEANUP_STATUSES = [JobStatus.COMPLETED, JobStatus.FAILED] as const;

/** A stop call keeps this handle across its execution drain, including restarts. */
export interface MaintenanceRun {
  readonly beginDrain: (keepHeartbeat: boolean) => Effect.Effect<void>;
  readonly stop: Effect.Effect<void>;
}

export interface SchedulerMaintenance {
  readonly start: Effect.Effect<MaintenanceRun>;
  readonly cleanupJobs: Effect.Effect<void, JobPersistenceError>;
}

interface MaintenanceDependencies {
  readonly options: Pick<
    ResolvedMonqueOptions,
    "heartbeatInterval" | "leaseDuration" | "recoverStaleJobs" | "jobRetention"
  >;
  readonly collection: Collection;
  readonly ownership: JobOwnership["Service"];
  /** The execution owner supplies a fresh snapshot; maintenance owns no Claim registry. */
  readonly activeClaimIds: () => readonly string[];
  readonly emit: <K extends keyof MonqueEventMap>(event: K, payload: MonqueEventMap[K]) => boolean;
  readonly notifyPendingJob: (name: string | undefined, nextRunAt: Date) => void;
}

/**
 * Composed once in the instance Layer. Run scopes own schedules; the instance
 * scope owns already-started writes, which finish even after a run stops. Closing
 * a run never waits for a database write or a Promise Worker. Native Db, client
 * and sessions are borrowed and are never finalized here.
 */
export const makeSchedulerMaintenance = Effect.fnUntraced(function* makeSchedulerMaintenance(
  dependencies: MaintenanceDependencies,
): Effect.fn.Return<SchedulerMaintenance, never, Scope.Scope> {
  const { options, ownership, collection, activeClaimIds, emit, notifyPendingJob } = dependencies;
  const instanceScope = yield* Scope.Scope;
  const heartbeatPermit = yield* Semaphore.make(1);
  const cleanupPermit = yield* Semaphore.make(1);
  let current: MaintenanceRun | undefined;

  const reportFailure = <A, E>(operation: Effect.Effect<A, E>) =>
    operation.pipe(
      Effect.mapError((failure) =>
        failure instanceof JobPersistenceError ? failure.cause : failure,
      ),
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          emit("job:error", { error: toError(Cause.squash(cause)) });
        }),
      ),
    );

  const forkOperation = <A, E>(operation: Effect.Effect<A, E>) =>
    Effect.forkIn(operation, instanceScope, { startImmediately: true, uninterruptible: true });

  const dispatch = <A, E>(operation: Effect.Effect<A, E>) =>
    forkOperation(operation).pipe(
      Effect.tap((fiber) => Effect.sync(() => observeBackgroundFailure(fiber))),
    );

  const cleanupJobs = Effect.gen(function* cleanExpiredJobs() {
    if (!options.jobRetention) {
      return;
    }

    const now = yield* Clock.currentTimeMillis;

    const deletions = [...CLEANUP_STATUSES, JobStatus.CANCELLED].flatMap((status) => {
      const age = options.jobRetention?.[status];

      return age === null || age === undefined
        ? []
        : [
            Effect.tryPromise({
              try: async () =>
                await collection.deleteMany({ status, updatedAt: { $lt: new Date(now - age) } }),
              catch: (cause) => new JobPersistenceError({ cause }),
            }),
          ];
    });

    if (deletions.length > 0 && (yield* cleanupPermit.takeIfAvailable(1))) {
      const fibers = yield* forEachEffect(deletions, forkOperation);

      // Report the first failure promptly, but retain the permit until every
      // native deletion settles. Later ticks (also after restart) are skipped.
      yield* forkOperation(Fiber.awaitAll(fibers).pipe(Effect.andThen(cleanupPermit.release(1))));
      yield* Fiber.joinAll(fibers);
    }
  }).pipe(Effect.asVoid, Effect.uninterruptible);

  const notifyRecovery = (count: number, now: Date) =>
    attempt(() => {
      emit("stale:recovered", { count });
      notifyPendingJob(undefined, now);
    });

  const start = Effect.gen(function* startMaintenanceRun() {
    if (current) {
      yield* current.stop;
    }

    const heartbeatScope = yield* Scope.fork(instanceScope);
    const cleanupScope = yield* Scope.fork(instanceScope);
    let recovering = true;

    const stop = Effect.gen(function* stopMaintenanceRun() {
      recovering = false;
      yield* Scope.close(cleanupScope, Exit.void);
      yield* Scope.close(heartbeatScope, Exit.void);
    });

    const run: MaintenanceRun = {
      beginDrain: Effect.fnUntraced(function* beginMaintenanceDrain(keepHeartbeat: boolean) {
        recovering = false;
        yield* Scope.close(cleanupScope, Exit.void);

        if (!keepHeartbeat) {
          yield* Scope.close(heartbeatScope, Exit.void);
        }
      }),
      stop,
    };

    // Publish before immediate cleanup can synchronously reenter the adapter.
    current = run;

    const heartbeat = Effect.gen(function* refreshOwnedHeartbeats() {
      const claimIds = yield* Effect.sync(activeClaimIds);
      yield* ownership.updateOwnedHeartbeats(claimIds);

      if (recovering && options.leaseDuration !== undefined && options.recoverStaleJobs) {
        const count = yield* ownership.recoverStaleJobs;

        if (count > 0) {
          const now = yield* Clock.currentTimeMillis;
          yield* notifyRecovery(count, new Date(now));
        }
      }
    }).pipe(heartbeatPermit.withPermitsIfAvailable(1), reportFailure);

    yield* Effect.forkIn(
      Effect.sleep(options.heartbeatInterval).pipe(
        Effect.andThen(
          dispatch(heartbeat).pipe(Effect.repeat(monotonicFixed(options.heartbeatInterval))),
        ),
      ),
      heartbeatScope,
      { startImmediately: true, uninterruptible: false },
    );

    if (options.jobRetention) {
      yield* Effect.forkIn(
        dispatch(reportFailure(cleanupJobs)).pipe(
          Effect.repeat(
            monotonicFixed(options.jobRetention.interval ?? DEFAULT_RETENTION_INTERVAL),
          ),
        ),
        cleanupScope,
        { startImmediately: true, uninterruptible: false },
      );
    }

    return run;
  }).pipe(Effect.uninterruptible);

  return { start, cleanupJobs };
});
