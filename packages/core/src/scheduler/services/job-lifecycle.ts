import { randomUUID } from "node:crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Random from "effect/Random";
import type { Document, Filter } from "mongodb";

import { isPersistedJob, JobStatus } from "@/jobs";
import type { Job, PersistedJob } from "@/jobs";
import {
  ConnectionError,
  DEFAULT_JITTER_FACTOR,
  DEFAULT_MAX_BACKOFF_DELAY,
  calculateBackoffDelay,
  getNextCronDate,
  NonRetryableError,
} from "@/shared";
import type { RetryOptions } from "@/workers";

import { attempt, fromPromise } from "../effects.js";
import type { SchedulerContext } from "./types.js";

const hasClaimIdentifier = (claimId: string | undefined): claimId is string => Boolean(claimId);

const protectActiveLease = (filter: Filter<Document>, enabled: boolean): Filter<Document> => {
  if (enabled) {
    filter["$expr"] = { $gt: ["$leaseExpiresAt", "$$NOW"] };
  }
  return filter;
};

export const CLAIM_CLEANUP_FIELDS = {
  lockedAt: "",
  claimedBy: "",
  claimId: "",
  leaseExpiresAt: "",
  lastHeartbeat: "",
} as const;
/**
 * Concentrates ownership-sensitive job lifecycle operations.
 *
 * Keeps Claim and Owned Job persistence invariants local so callers do not need
 * to know the backing MongoDB fields.
 *
 * Not part of public API.
 * @internal
 */
export class JobLifecycle {
  private readonly ctx: SchedulerContext;
  constructor(ctx: SchedulerContext) {
    this.ctx = ctx;
  }
  /**
   * Atomically claim the highest-priority due pending Job for a Worker.
   */
  claimNext = Effect.fnUntraced(function* claimNextJob(
    this: JobLifecycle,
    name: string,
  ): Effect.fn.Return<PersistedJob | null, unknown> {
    if (!(yield* attempt(() => this.ctx.isRunning() && !this.ctx.isPaused(name)))) {
      return null;
    }
    const now = yield* DateTime.nowAsDate;
    const { leaseDuration } = this.ctx.options;
    const claim = {
      status: JobStatus.PROCESSING,
      claimedBy: this.ctx.instanceId,
      claimId: randomUUID(),
      lockedAt: now,
      lastHeartbeat: now,
      heartbeatInterval: this.ctx.options.heartbeatInterval,
      updatedAt: now,
    };
    const result = yield* fromPromise(
      async () =>
        await this.ctx.collection.findOneAndUpdate(
          {
            name,
            status: JobStatus.PENDING,
            nextRunAt: { $lte: now },
          },
          leaseDuration === undefined
            ? { $set: claim, $unset: { leaseExpiresAt: "" } }
            : [
                {
                  $set: {
                    ...claim,
                    claimedBy: { $literal: this.ctx.instanceId },
                    lockedAt: "$$NOW",
                    lastHeartbeat: "$$NOW",
                    updatedAt: "$$NOW",
                    leaseExpiresAt: { $add: ["$$NOW", leaseDuration] },
                  },
                },
              ],
          {
            sort: { priority: -1, nextRunAt: 1, _id: 1 },
            returnDocument: "after",
          },
        ),
    );
    return result ? yield* attempt(() => this.ctx.documentToPersistedJob(result)) : null;
  });
  /**
   * Release a just-claimed job when processing cannot start.
   */
  releaseOwnedClaim = Effect.fnUntraced(function* releaseOwnedJob(
    this: JobLifecycle,
    job: PersistedJob,
  ): Effect.fn.Return<void, unknown> {
    const now = yield* DateTime.nowAsDate;
    yield* fromPromise(
      async () =>
        await this.ctx.collection.updateOne(this.ownedJobFilter(job), {
          $set: {
            status: JobStatus.PENDING,
            updatedAt: now,
          },
          $unset: CLAIM_CLEANUP_FIELDS,
        }),
    );
  });
  /**
   * Complete an Owned Job or reschedule its recurring next run.
   */
  completeOwned = Effect.fnUntraced(function* completeOwnedJob(
    this: JobLifecycle,
    job: Job,
  ): Effect.fn.Return<PersistedJob | null, unknown> {
    if (!isPersistedJob(job)) {
      return null;
    }
    const now = yield* DateTime.nowAsDate;
    const { repeatInterval } = job;
    const completion =
      repeatInterval !== undefined && repeatInterval
        ? {
            status: JobStatus.PENDING,
            nextRunAt: yield* attempt(() => getNextCronDate(repeatInterval, now, job.timezone)),
            failCount: 0,
          }
        : { status: JobStatus.COMPLETED };
    const result = yield* fromPromise(
      async () =>
        await this.ctx.collection.findOneAndUpdate(
          this.ownedJobFilter(job),
          {
            $set: { ...completion, updatedAt: now },
            $unset: { ...CLAIM_CLEANUP_FIELDS, failReason: "" },
          },
          { returnDocument: "after" },
        ),
    );
    if (!result) {
      return null;
    }
    const persistedJob = yield* attempt(() => this.ctx.documentToPersistedJob(result));
    if (completion.status === JobStatus.PENDING) {
      yield* attempt(() => {
        this.ctx.notifyPendingJob(persistedJob.name, persistedJob.nextRunAt);
      });
    }
    return persistedJob;
  });
  /**
   * Fail an Owned Job, either scheduling a retry or marking it terminal.
   */
  failOwned = Effect.fnUntraced(function* failOwnedJob(
    this: JobLifecycle,
    job: Job,
    error: Error,
    options: RetryOptions = {},
  ): Effect.fn.Return<PersistedJob | null, unknown> {
    if (!isPersistedJob(job)) {
      return null;
    }
    const now = yield* DateTime.now;
    const newFailCount = job.failCount + 1;
    const terminal =
      error instanceof NonRetryableError ||
      newFailCount >= (options.maxRetries ?? this.ctx.options.maxRetries);
    const retry = terminal
      ? { status: JobStatus.FAILED }
      : {
          status: JobStatus.PENDING,
          nextRunAt: yield* this.retryDate(newFailCount, options),
        };
    const result = yield* fromPromise(
      async () =>
        await this.ctx.collection.findOneAndUpdate(
          this.ownedJobFilter(job),
          {
            $set: {
              ...retry,
              failCount: newFailCount,
              failReason: error.message,
              updatedAt: DateTime.toDateUtc(now),
            },
            $unset: CLAIM_CLEANUP_FIELDS,
          },
          { returnDocument: "after" },
        ),
    );
    if (!result) {
      return null;
    }
    const persistedJob = yield* attempt(() => this.ctx.documentToPersistedJob(result));
    if (!terminal) {
      yield* attempt(() => {
        this.ctx.notifyPendingJob(persistedJob.name, persistedJob.nextRunAt);
      });
    }
    return persistedJob;
  });
  private readonly retryDate = Effect.fnUntraced(function* calculateRetryDate(
    this: JobLifecycle,
    failCount: number,
    options: RetryOptions,
  ): Effect.fn.Return<Date> {
    const maxDelay =
      options.maxBackoffDelay ?? this.ctx.options.maxBackoffDelay ?? DEFAULT_MAX_BACKOFF_DELAY;
    const baseDelay = calculateBackoffDelay(
      failCount,
      options.baseRetryInterval ?? this.ctx.options.baseRetryInterval,
      maxDelay,
      0,
    );
    const spread = baseDelay * DEFAULT_JITTER_FACTOR;
    const jitter = baseDelay <= 0 ? 0 : ((yield* Random.next) * 2 - 1) * spread;
    const delay = Math.min(Math.max(0, Math.round(baseDelay + jitter)), maxDelay);
    const now = yield* DateTime.now;
    return DateTime.toDateUtc(DateTime.mapEpochMillis(now, (millis) => millis + delay));
  });
  /**
   * Refresh heartbeat timestamps for jobs owned by this scheduler instance.
   */
  updateOwnedHeartbeats = Effect.fnUntraced(function* refreshOwnedJobHeartbeats(
    this: JobLifecycle,
  ): Effect.fn.Return<void, unknown> {
    const claimIds: string[] = [];
    for (const worker of this.ctx.workers.values()) {
      for (const job of worker.activeJobs.values()) {
        if (hasClaimIdentifier(job.claimId)) {
          claimIds.push(job.claimId);
        }
      }
    }
    if (claimIds.length === 0) {
      return;
    }
    const now = yield* DateTime.nowAsDate;
    const { leaseDuration } = this.ctx.options;
    yield* fromPromise(
      async () =>
        await this.ctx.collection.updateMany(
          protectActiveLease(
            {
              claimedBy: this.ctx.instanceId,
              claimId: { $in: claimIds },
              status: JobStatus.PROCESSING,
            },
            leaseDuration !== undefined,
          ),
          leaseDuration === undefined
            ? {
                $set: {
                  lastHeartbeat: now,
                  updatedAt: now,
                },
              }
            : [
                {
                  $set: {
                    lastHeartbeat: "$$NOW",
                    updatedAt: "$$NOW",
                    leaseExpiresAt: { $add: ["$$NOW", leaseDuration] },
                  },
                },
              ],
        ),
    );
  });
  /**
   * Recover processing jobs whose ownership lock has expired.
   */
  recoverStaleJobs = Effect.fnUntraced(function* recoverStaleClaims(
    this: JobLifecycle,
  ): Effect.fn.Return<void, unknown> {
    const now = yield* DateTime.now;
    const staleThreshold = DateTime.toDateUtc(
      DateTime.subtractDuration(now, this.ctx.options.lockTimeout),
    );
    const result = yield* fromPromise(
      async () =>
        await this.ctx.collection.updateMany(
          {
            status: JobStatus.PROCESSING,
            $or: [
              { leaseExpiresAt: { $exists: false }, lockedAt: { $lt: staleThreshold } },
              { leaseExpiresAt: { $exists: true }, $expr: { $lte: ["$leaseExpiresAt", "$$NOW"] } },
            ],
          },
          {
            $set: {
              status: JobStatus.PENDING,
              updatedAt: DateTime.toDateUtc(now),
            },
            $unset: CLAIM_CLEANUP_FIELDS,
          },
        ),
    );
    if (result.modifiedCount > 0) {
      const nextRunAt = yield* DateTime.nowAsDate;
      yield* attempt(() => {
        this.ctx.emit("stale:recovered", { count: result.modifiedCount });
        this.ctx.notifyPendingJob(undefined, nextRunAt);
      });
    }
  });
  /**
   * Guard startup against another active scheduler using this instance id.
   */
  assertNoActiveInstanceCollision = Effect.fnUntraced(function* checkInstanceCollision(
    this: JobLifecycle,
  ): Effect.fn.Return<void, unknown> {
    const now = yield* DateTime.now;
    const aliveThreshold = DateTime.toDateUtc(
      DateTime.subtractDuration(now, this.ctx.options.heartbeatInterval * 2),
    );
    const activeJob = yield* fromPromise(
      async () =>
        await this.ctx.collection.findOne({
          claimedBy: this.ctx.instanceId,
          status: JobStatus.PROCESSING,
          lastHeartbeat: { $gte: aliveThreshold },
        }),
    );
    if (activeJob) {
      return yield* Effect.fail(
        new ConnectionError(
          `Another active Monque instance is using schedulerInstanceId "${this.ctx.instanceId}". ` +
            `Found processing job "${activeJob["name"]}" with recent heartbeat. ` +
            `Use a unique schedulerInstanceId or wait for the other instance to stop.`,
        ),
      );
    }
    return yield* Effect.void;
  });
  /**
   * MongoDB precondition for mutating a job owned by this scheduler.
   */
  private ownedJobFilter(job: PersistedJob): Filter<Document> {
    return protectActiveLease(
      {
        _id: job._id,
        status: JobStatus.PROCESSING,
        claimedBy: this.ctx.instanceId,
        claimId: job.claimId ?? null,
      },
      job.leaseExpiresAt !== undefined,
    );
  }
}
