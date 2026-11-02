import { randomUUID } from "node:crypto";
import { Context, DateTime, Effect, Layer, Random } from "effect";
import type { Collection, Document, Filter } from "mongodb";

import { documentToPersistedJob, isPersistedJob, JobStatus } from "@/jobs";
import type { Job, PersistedJob } from "@/jobs";
import {
  DEFAULT_JITTER_FACTOR,
  DEFAULT_MAX_BACKOFF_DELAY,
  calculateBackoffDelay,
  getNextCronDate,
  NonRetryableError,
  InvalidCronError,
} from "@/shared";
import type { RetryOptions } from "@/workers";

import { JobPersistenceError } from "./job-persistence-error.js";
import { makeOperationTelemetry } from "./operation-telemetry.js";
import type { ResolvedMonqueOptions } from "./types.js";

/** Native driver boundary. Never retries ownership writes or application side effects. */
const persist = <A>(operation: () => Promise<A>): Effect.Effect<A, JobPersistenceError> =>
  Effect.tryPromise({ try: operation, catch: (cause) => new JobPersistenceError({ cause }) });

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

/** Database transition policy only; no Worker, admission, event or timer ownership. @internal */
export class JobOwnership extends Context.Service<
  JobOwnership,
  {
    readonly claimNext: (name: string) => Effect.Effect<PersistedJob | null, JobPersistenceError>;
    readonly releaseOwnedClaim: (job: PersistedJob) => Effect.Effect<void, JobPersistenceError>;
    readonly completeOwned: (
      job: Job,
    ) => Effect.Effect<PersistedJob | null, JobPersistenceError | InvalidCronError>;
    readonly failOwned: (
      job: Job,
      error: Error,
      options?: RetryOptions,
    ) => Effect.Effect<PersistedJob | null, JobPersistenceError>;
    readonly updateOwnedHeartbeats: (
      claimIds: readonly string[],
    ) => Effect.Effect<void, JobPersistenceError>;
    readonly recoverStaleJobs: Effect.Effect<number, JobPersistenceError>;
    readonly findActiveInstanceJob: Effect.Effect<string | null, JobPersistenceError>;
  }
>()("@monque/core/scheduler/JobOwnership") {}

type OwnershipOptions = Pick<
  ResolvedMonqueOptions,
  | "leaseDuration"
  | "heartbeatInterval"
  | "lockTimeout"
  | "maxRetries"
  | "baseRetryInterval"
  | "maxBackoffDelay"
>;

/** Borrows the collection; acquires no connection, session or background resources. */
export const makeNativeJobOwnership = (
  collection: Collection,
  instanceId: string,
  defaults: OwnershipOptions,
  telemetry = makeOperationTelemetry(),
): JobOwnership["Service"] => {
  /**
   * MongoDB precondition for mutating a job owned by this scheduler.
   */
  const ownedJobFilter = (job: PersistedJob): Filter<Document> =>
    protectActiveLease(
      {
        _id: job._id,
        status: JobStatus.PROCESSING,
        claimedBy: instanceId,
        claimId: job.claimId ?? null,
      },
      job.leaseExpiresAt !== undefined,
    );

  const retryDate = Effect.fnUntraced(function* calculateRetryDate(
    failCount: number,
    options: RetryOptions,
  ): Effect.fn.Return<Date> {
    const maxDelay =
      options.maxBackoffDelay ?? defaults.maxBackoffDelay ?? DEFAULT_MAX_BACKOFF_DELAY;

    const baseDelay = calculateBackoffDelay(
      failCount,
      options.baseRetryInterval ?? defaults.baseRetryInterval,
      maxDelay,
      0,
    );

    const spread = baseDelay * DEFAULT_JITTER_FACTOR;
    const jitter = baseDelay <= 0 ? 0 : ((yield* Random.next) * 2 - 1) * spread;
    const delay = Math.min(Math.max(0, Math.round(baseDelay + jitter)), maxDelay);
    const now = yield* DateTime.now;

    return DateTime.toDateUtc(DateTime.mapEpochMillis(now, (millis) => millis + delay));
  });

  return JobOwnership.of({
    /**
     * Atomically claim the highest-priority due pending Job for a Worker.
     */
    claimNext: Effect.fnUntraced(
      function* claimNextJob(
        name: string,
      ): Effect.fn.Return<PersistedJob | null, JobPersistenceError> {
        const now = yield* DateTime.nowAsDate;
        const { leaseDuration } = defaults;

        const claim = {
          status: JobStatus.PROCESSING,
          claimedBy: instanceId,
          claimId: randomUUID(),
          lockedAt: now,
          lastHeartbeat: now,
          heartbeatInterval: defaults.heartbeatInterval,
          updatedAt: now,
        };

        const result = yield* persist(
          async () =>
            await collection.findOneAndUpdate(
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
                        claimedBy: { $literal: instanceId },
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

        return result ? documentToPersistedJob(result) : null;
      },
      (body) => telemetry.observe("claim.acquire", body),
    ),
    /**
     * Release a just-claimed job when processing cannot start.
     */
    releaseOwnedClaim: Effect.fnUntraced(
      function* releaseOwnedJob(job: PersistedJob): Effect.fn.Return<void, JobPersistenceError> {
        const now = yield* DateTime.nowAsDate;
        yield* persist(
          async () =>
            await collection.updateOne(ownedJobFilter(job), {
              $set: {
                status: JobStatus.PENDING,
                updatedAt: now,
              },
              $unset: CLAIM_CLEANUP_FIELDS,
            }),
        );
      },
      (body) => telemetry.observe("claim.release", body),
    ),
    /**
     * Complete an Owned Job or reschedule its recurring next run.
     */
    completeOwned: Effect.fnUntraced(
      function* completeOwnedJob(
        job: Job,
      ): Effect.fn.Return<PersistedJob | null, JobPersistenceError | InvalidCronError> {
        if (!isPersistedJob(job)) {
          return null;
        }

        const now = yield* DateTime.nowAsDate;
        const { repeatInterval } = job;

        const completion =
          repeatInterval !== undefined && repeatInterval
            ? {
                status: JobStatus.PENDING,
                nextRunAt: yield* Effect.try({
                  try: () => getNextCronDate(repeatInterval, now, job.timezone),
                  catch: (cause) =>
                    cause instanceof InvalidCronError ? cause : new JobPersistenceError({ cause }),
                }),
                failCount: 0,
              }
            : { status: JobStatus.COMPLETED };

        const result = yield* persist(
          async () =>
            await collection.findOneAndUpdate(
              ownedJobFilter(job),
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

        return documentToPersistedJob(result);
      },
      (body) => telemetry.observe("result.complete", body),
    ),
    /**
     * Fail an Owned Job, either scheduling a retry or marking it terminal.
     */
    failOwned: Effect.fnUntraced(
      function* failOwnedJob(
        job: Job,
        error: Error,
        options: RetryOptions = {},
      ): Effect.fn.Return<PersistedJob | null, JobPersistenceError> {
        if (!isPersistedJob(job)) {
          return null;
        }

        const now = yield* DateTime.now;
        const newFailCount = job.failCount + 1;

        const terminal =
          error instanceof NonRetryableError ||
          newFailCount >= (options.maxRetries ?? defaults.maxRetries);

        const retry = terminal
          ? { status: JobStatus.FAILED }
          : {
              status: JobStatus.PENDING,
              nextRunAt: yield* retryDate(newFailCount, options),
            };

        const result = yield* persist(
          async () =>
            await collection.findOneAndUpdate(
              ownedJobFilter(job),
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

        return documentToPersistedJob(result);
      },
      (body) => telemetry.observe("result.fail", body),
    ),
    /**
     * Refresh heartbeat timestamps for jobs owned by this scheduler instance.
     */
    updateOwnedHeartbeats: Effect.fnUntraced(function* refreshOwnedJobHeartbeats(
      claimIds: readonly string[],
    ): Effect.fn.Return<void, JobPersistenceError> {
      if (claimIds.length === 0) {
        return;
      }

      const now = yield* DateTime.nowAsDate;
      const { leaseDuration } = defaults;
      yield* persist(
        async () =>
          await collection.updateMany(
            protectActiveLease(
              {
                claimedBy: instanceId,
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
    }),
    /**
     * Recover processing jobs whose ownership lock has expired.
     */
    recoverStaleJobs: Effect.gen(function* recoverStaleClaims(): Effect.fn.Return<
      number,
      JobPersistenceError
    > {
      const now = yield* DateTime.now;

      const staleThreshold = DateTime.toDateUtc(
        DateTime.subtractDuration(now, defaults.lockTimeout),
      );

      const result = yield* persist(
        async () =>
          await collection.updateMany(
            {
              status: JobStatus.PROCESSING,
              $or: [
                { leaseExpiresAt: { $exists: false }, lockedAt: { $lt: staleThreshold } },
                {
                  leaseExpiresAt: { $exists: true },
                  $expr: { $lte: ["$leaseExpiresAt", "$$NOW"] },
                },
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

      return result.modifiedCount;
    }).pipe((body) => telemetry.observe("recovery", body)),
    /**
     * Guard startup against another active scheduler using this instance id.
     */
    findActiveInstanceJob: Effect.gen(function* checkInstanceCollision(): Effect.fn.Return<
      string | null,
      JobPersistenceError
    > {
      const now = yield* DateTime.now;

      const aliveThreshold = DateTime.toDateUtc(
        DateTime.subtractDuration(now, defaults.heartbeatInterval * 2),
      );

      const activeJob = yield* persist(
        async () =>
          await collection.findOne({
            claimedBy: instanceId,
            status: JobStatus.PROCESSING,
            lastHeartbeat: { $gte: aliveThreshold },
          }),
      );

      return activeJob ? String(activeJob["name"]) : null;
    }),
  });
};

export const makeNativeJobOwnershipLayer = (
  collection: Collection,
  instanceId: string,
  options: OwnershipOptions,
  telemetry = makeOperationTelemetry(),
): Layer.Layer<JobOwnership> =>
  Layer.succeed(JobOwnership, makeNativeJobOwnership(collection, instanceId, options, telemetry));
