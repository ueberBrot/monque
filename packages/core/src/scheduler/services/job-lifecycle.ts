import { DateTime, Effect } from "effect";

import { JobStatus } from "@/jobs";
import type { Job, PersistedJob } from "@/jobs";
import { ConnectionError } from "@/shared";
import type { RetryOptions } from "@/workers";

import { attempt } from "../effects.js";
import { makeNativeJobOwnership } from "./job-ownership.js";
import type { JobOwnership } from "./job-ownership.js";
import { JobPersistenceError } from "./job-persistence-error.js";
import type { SchedulerContext } from "./types.js";

/**
 * Temporary adapter for admission and synchronous event/notification delivery.
 * Database transition policy belongs exclusively to JobOwnership.
 * @internal
 */
export class JobLifecycle {
  private readonly ctx: SchedulerContext;
  private readonly ownership: JobOwnership["Service"];
  constructor(
    ctx: SchedulerContext,
    ownership: JobOwnership["Service"] = makeNativeJobOwnership(
      ctx.collection,
      ctx.instanceId,
      ctx.options,
    ),
  ) {
    this.ctx = ctx;
    this.ownership = ownership;
  }

  claimNext = Effect.fnUntraced(function* claimNextJob(this: JobLifecycle, name: string) {
    if (!(yield* attempt(() => this.ctx.isRunning() && !this.ctx.isPaused(name)))) {
      return null;
    }

    return yield* this.ownership.claimNext(name).pipe(Effect.mapError((failure) => failure.cause));
  });

  releaseOwnedClaim = Effect.fnUntraced(function* releaseOwnedJob(
    this: JobLifecycle,
    job: PersistedJob,
  ) {
    yield* this.ownership.releaseOwnedClaim(job).pipe(Effect.mapError((failure) => failure.cause));
  });

  completeOwned = Effect.fnUntraced(function* completeOwnedJob(this: JobLifecycle, job: Job) {
    const result = yield* this.ownership
      .completeOwned(job)
      .pipe(
        Effect.mapError((error) => (error instanceof JobPersistenceError ? error.cause : error)),
      );

    if (result?.status === JobStatus.PENDING) {
      yield* attempt(() => {
        this.ctx.notifyPendingJob(result.name, result.nextRunAt);
      });
    }

    return result;
  });

  failOwned = Effect.fnUntraced(function* failOwnedJob(
    this: JobLifecycle,
    job: Job,
    error: Error,
    options: RetryOptions = {},
  ) {
    const result = yield* this.ownership
      .failOwned(job, error, options)
      .pipe(Effect.mapError((failure) => failure.cause));

    if (result?.status === JobStatus.PENDING) {
      yield* attempt(() => {
        this.ctx.notifyPendingJob(result.name, result.nextRunAt);
      });
    }

    return result;
  });

  updateOwnedHeartbeats = Effect.fnUntraced(function* refreshOwnedJobHeartbeats(
    this: JobLifecycle,
  ) {
    const claimIds: string[] = [];

    for (const worker of this.ctx.workers.values()) {
      for (const job of worker.activeJobs.values()) {
        if (job.claimId !== undefined && job.claimId !== "") {
          claimIds.push(job.claimId);
        }
      }
    }

    yield* this.ownership
      .updateOwnedHeartbeats(claimIds)
      .pipe(Effect.mapError((failure) => failure.cause));
  });

  recoverStaleJobs = Effect.fnUntraced(function* recoverStaleClaims(this: JobLifecycle) {
    const count = yield* this.ownership.recoverStaleJobs.pipe(
      Effect.mapError((failure) => failure.cause),
    );

    if (count > 0) {
      const nextRunAt = yield* DateTime.nowAsDate;
      yield* attempt(() => {
        this.ctx.emit("stale:recovered", { count });
        this.ctx.notifyPendingJob(undefined, nextRunAt);
      });
    }
  });

  assertNoActiveInstanceCollision = Effect.fnUntraced(function* checkInstanceCollision(
    this: JobLifecycle,
  ) {
    const name = yield* this.ownership.findActiveInstanceJob.pipe(
      Effect.mapError((failure) => failure.cause),
    );

    if (name !== null) {
      return yield* Effect.fail(
        new ConnectionError(
          `Another active Monque instance is using schedulerInstanceId "${this.ctx.instanceId}". ` +
            `Found processing job "${name}" with recent heartbeat. ` +
            `Use a unique schedulerInstanceId or wait for the other instance to stop.`,
        ),
      );
    }

    return yield* Effect.void;
  });
}
