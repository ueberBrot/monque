import { Context, DateTime, Effect, Layer, Predicate, Result, Stream } from "effect";
import { ObjectId } from "mongodb";
import type { Collection, Document, WithId } from "mongodb";

import type { MonqueEventMap } from "@/events";
import { documentToPersistedJob, JobStatus } from "@/jobs";
import type { BulkOperationResult, JobSelector, PersistedJob } from "@/jobs";
import {
  ConnectionError,
  InvalidJobPriorityError,
  JobStateError,
  MonqueError,
  toError,
} from "@/shared";
import { definedProperty } from "@/shared/utils/defined-property.js";
import { validateJobPriority } from "@/shared/utils/job-priority.js";

import { attempt } from "../effects.js";
import { buildSelectorQuery } from "../helpers.js";
import { CLAIM_CLEANUP_FIELDS } from "./job-ownership.js";
import { JobPersistenceError } from "./job-persistence-error.js";
import { JobQueries } from "./job-queries.js";
import { RETRYABLE_JOB_STATUSES } from "./types.js";
import type { RetryableJobStatusType } from "./types.js";

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Native database failures may be arbitrary values; preserve MonqueError identity and legacy fallback messages.
const jobMutationError = (failure: unknown, operation: string, action: string): MonqueError => {
  const error = failure instanceof JobPersistenceError ? failure.cause : failure;

  if (error instanceof MonqueError) {
    return error;
  }

  const message = error instanceof Error ? error.message : `Unknown error during ${operation}`;

  return new ConnectionError(
    `Failed to ${action}: ${message}`,
    error instanceof Error ? { cause: error } : undefined,
  );
};

type PendingNotificationDocument = Document & {
  name?: unknown;
  nextRunAt?: unknown;
};

type PendingJobEdit =
  | {
      action: "reschedule";
      runAt: Date;
    }
  | {
      action: "setJobPriority";
      priority: number;
    };

/** Narrow native inputs; no Worker, execution, ownership or notification policy. */
export interface JobManagementDependencies {
  readonly collection: Collection;
  readonly emit: <K extends keyof MonqueEventMap>(event: K, payload: MonqueEventMap[K]) => boolean;
  readonly notifyPendingJob: (name: string | undefined, nextRunAt: Date) => void;
}

/** Native driver failures retain the original object, including partial-write details. */
const persist = <A>(operation: () => Promise<A>): Effect.Effect<A, JobPersistenceError> =>
  Effect.tryPromise({ try: operation, catch: (cause) => new JobPersistenceError({ cause }) });

const editPendingJob = Effect.fnUntraced(function* editSinglePendingJob(
  dependencies: JobManagementDependencies,
  jobId: string,
  edit: PendingJobEdit,
): Effect.fn.Return<PersistedJob | null, unknown> {
  if (!ObjectId.isValid(jobId)) {
    return null;
  }

  const _id = new ObjectId(jobId);
  const now = yield* DateTime.nowAsDate;

  const fields =
    edit.action === "reschedule" ? { nextRunAt: edit.runAt } : { priority: edit.priority };

  const result = yield* persist(
    async () =>
      await dependencies.collection.findOneAndUpdate(
        { _id, status: JobStatus.PENDING },
        { $set: { ...fields, updatedAt: now } },
        { returnDocument: "after" },
      ),
  );

  if (result) {
    const job = yield* attempt(() => documentToPersistedJob(result));
    yield* attempt(() => {
      dependencies.notifyPendingJob(job.name, job.nextRunAt);
    });

    return job;
  }

  const currentJob = yield* persist(
    async () => await dependencies.collection.findOne<WithId<{ status: string }>>({ _id }),
  );

  if (!currentJob) {
    return null;
  }

  const action = edit.action === "reschedule" ? "reschedule" : "change priority of";

  return yield* Effect.fail(
    new JobStateError(
      `Cannot ${action} job in status '${currentJob.status}'`,
      jobId,
      currentJob.status,
      edit.action,
    ),
  );
});

const notifyRetriedPendingJobs = Effect.fnUntraced(function* notifyRetriedJobs(
  dependencies: JobManagementDependencies,
  filter: JobSelector,
  updatedAt: Date,
): Effect.fn.Return<void, unknown> {
  // Retried Jobs are pending; retain only the original name and creation-date scope.
  const query = yield* attempt(() =>
    buildSelectorQuery({
      ...definedProperty(filter, "name"),
      ...definedProperty(filter, "olderThan"),
      ...definedProperty(filter, "newerThan"),
    }),
  );

  query["status"] = JobStatus.PENDING;
  query["updatedAt"] = updatedAt;

  const cursor = yield* attempt(() => {
    const { collection } = dependencies;
    const findNotificationJobs = collection.find.bind(collection);

    return findNotificationJobs<PendingNotificationDocument>(query, {
      projection: { name: 1, nextRunAt: 1 },
    });
  });

  let notified = false;
  yield* Stream.fromAsyncIterable(cursor, (error) => error).pipe(
    Stream.runForEach((job) =>
      attempt(() => {
        notified = true;
        const name = Predicate.isString(job.name) ? job.name : undefined;
        const nextRunAt = job.nextRunAt instanceof Date ? job.nextRunAt : updatedAt;
        dependencies.notifyPendingJob(name, nextRunAt);
      }),
    ),
  );

  if (!notified) {
    yield* attempt(() => {
      dependencies.notifyPendingJob(filter.name, updatedAt);
    });
  }
});

/** Management owns writes, synchronous delivery and final invalidation as one operation. */
export const makeJobManagement = (
  dependencies: JobManagementDependencies,
  queries: Pick<JobQueries["Service"], "clearStatsCache">,
) => {
  const invalidate = Effect.ensuring(
    Effect.sync(() => {
      queries.clearStatsCache();
    }),
  );

  const cancelJob = Effect.fnUntraced(
    function* cancelSingleJob(jobId: string): Effect.fn.Return<PersistedJob | null, unknown> {
      if (!ObjectId.isValid(jobId)) {
        return null;
      }

      const _id = new ObjectId(jobId);
      const now = yield* DateTime.nowAsDate;

      const result = yield* persist(
        async () =>
          await dependencies.collection.findOneAndUpdate(
            { _id, status: JobStatus.PENDING },
            {
              $set: {
                status: JobStatus.CANCELLED,
                updatedAt: now,
              },
            },
            { returnDocument: "after" },
          ),
      );

      if (result) {
        const job = yield* attempt(() => documentToPersistedJob(result));
        yield* attempt(() => dependencies.emit("job:cancelled", { job }));

        return job;
      }

      const jobDoc = yield* persist(
        async () => await dependencies.collection.findOne<WithId<{ status: string }>>({ _id }),
      );

      if (!jobDoc) {
        return null;
      }

      if (jobDoc.status === JobStatus.CANCELLED) {
        return yield* attempt(() => documentToPersistedJob(jobDoc));
      }

      return yield* Effect.fail(
        new JobStateError(
          `Cannot cancel job in status '${jobDoc.status}'`,
          jobId,
          jobDoc.status,
          "cancel",
        ),
      );
    },
    Effect.mapError((failure) => jobMutationError(failure, "cancelJob", "cancel job")),
    invalidate,
  );

  const retryJob = Effect.fnUntraced(
    function* retrySingleJob(jobId: string): Effect.fn.Return<PersistedJob | null, unknown> {
      if (!ObjectId.isValid(jobId)) {
        return null;
      }

      const _id = new ObjectId(jobId);
      const now = yield* DateTime.nowAsDate;

      const update = {
        $set: {
          status: JobStatus.PENDING,
          failCount: 0,
          nextRunAt: now,
          updatedAt: now,
        },
        $unset: { failReason: "", ...CLAIM_CLEANUP_FIELDS },
      };

      const result = yield* persist(
        async () =>
          await dependencies.collection.findOneAndUpdate(
            {
              _id,
              status: { $in: RETRYABLE_JOB_STATUSES },
            },
            update,
            { returnDocument: "before" },
          ),
      );

      if (!result) {
        const currentJob = yield* persist(
          async () => await dependencies.collection.findOne<WithId<{ status: string }>>({ _id }),
        );

        if (!currentJob) {
          return null;
        }

        return yield* Effect.fail(
          new JobStateError(
            `Cannot retry job in status '${currentJob.status}'`,
            jobId,
            currentJob.status,
            "retry",
          ),
        );
      }

      // SAFETY: The atomic update only matches RETRYABLE_JOB_STATUSES and returns the
      // document before that update, so this event reports one of those statuses.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- MongoDB's update overload erases the query's status constraint.
      const previousStatus = result["status"] as RetryableJobStatusType;
      const updatedDoc: WithId<Document> = { ...result, ...update.$set };

      for (const field of Object.keys(update.$unset)) {
        // oxlint-disable-next-line typescript/no-dynamic-delete -- Apply MongoDB's dynamic $unset keys to the returned document too.
        delete updatedDoc[field];
      }

      const job = yield* attempt(() => documentToPersistedJob(updatedDoc));
      yield* attempt(() => {
        dependencies.notifyPendingJob(job.name, job.nextRunAt);
      });
      yield* attempt(() => dependencies.emit("job:retried", { job, previousStatus }));

      return job;
    },
    Effect.mapError((failure) => jobMutationError(failure, "retryJob", "retry job")),
    invalidate,
  );

  const rescheduleJob = Effect.fnUntraced(
    function* rescheduleSingleJob(
      jobId: string,
      runAt: Date,
    ): Effect.fn.Return<PersistedJob | null, unknown> {
      return yield* editPendingJob(dependencies, jobId, { action: "reschedule", runAt });
    },
    Effect.mapError((failure) => jobMutationError(failure, "rescheduleJob", "reschedule job")),
    invalidate,
  );

  const setJobPriority = Effect.fnUntraced(
    function* setSingleJobPriority(
      jobId: string,
      priority: number,
    ): Effect.fn.Return<PersistedJob | null, unknown> {
      yield* attempt(() => {
        if (priority === undefined) {
          throw new InvalidJobPriorityError();
        }

        validateJobPriority(priority);
      });

      return yield* editPendingJob(dependencies, jobId, { action: "setJobPriority", priority });
    },
    Effect.mapError((failure) =>
      jobMutationError(failure, "setJobPriority", "change job priority"),
    ),
    invalidate,
  );

  const deleteJob = Effect.fnUntraced(
    function* deleteSingleJob(jobId: string): Effect.fn.Return<boolean, unknown> {
      if (!ObjectId.isValid(jobId)) {
        return false;
      }

      const _id = new ObjectId(jobId);
      const result = yield* persist(async () => await dependencies.collection.deleteOne({ _id }));

      if (result.deletedCount > 0) {
        yield* attempt(() => dependencies.emit("job:deleted", { jobId }));

        return true;
      }

      return false;
    },
    Effect.mapError((failure) => jobMutationError(failure, "deleteJob", "delete job")),
    invalidate,
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Bulk Operations
  // ─────────────────────────────────────────────────────────────────────────────
  const cancelJobs = Effect.fnUntraced(function* cancelMatchingJobs(
    filter: JobSelector,
  ): Effect.fn.Return<BulkOperationResult, unknown> {
    const query = yield* attempt(() => buildSelectorQuery(filter));

    // Enforce allowed status, but respect explicit status filters
    if (filter.status !== undefined) {
      const requested = Array.isArray(filter.status) ? filter.status : [filter.status];

      if (!requested.includes(JobStatus.PENDING)) {
        return { count: 0, errors: [] };
      }
    }

    query["status"] = JobStatus.PENDING;

    return yield* Effect.gen(function* writeCancelledJobs() {
      const now = yield* DateTime.nowAsDate;

      const result = yield* persist(
        async () =>
          await dependencies.collection.updateMany(query, {
            $set: {
              status: JobStatus.CANCELLED,
              updatedAt: now,
            },
          }),
      );

      const count = result.modifiedCount;

      if (count > 0) {
        yield* attempt(() => dependencies.emit("jobs:cancelled", { count }));
      }

      return { count, errors: [] };
    }).pipe(Effect.mapError((failure) => jobMutationError(failure, "cancelJobs", "cancel jobs")));
  }, invalidate);

  const retryJobs = Effect.fnUntraced(function* retryMatchingJobs(
    filter: JobSelector,
  ): Effect.fn.Return<BulkOperationResult, unknown> {
    const query = yield* attempt(() => buildSelectorQuery(filter));

    // Enforce allowed statuses, but respect explicit status filters
    if (filter.status === undefined) {
      query["status"] = { $in: RETRYABLE_JOB_STATUSES };
    } else {
      const requested = Array.isArray(filter.status) ? filter.status : [filter.status];

      const allowed = requested.filter((status): status is RetryableJobStatusType =>
        RETRYABLE_JOB_STATUSES.some((retryableStatus) => retryableStatus === status),
      );

      if (allowed.length === 0) {
        return { count: 0, errors: [] };
      }

      query["status"] = allowed.length === 1 ? allowed[0] : { $in: allowed };
    }

    // 30s max spread for staggered retry
    const spreadWindowMs = 30_000;

    return yield* Effect.gen(function* writeRetriedJobs() {
      const now = yield* DateTime.nowAsDate;

      const result = yield* persist(
        async () =>
          await dependencies.collection.updateMany(query, [
            {
              $set: {
                status: JobStatus.PENDING,
                failCount: 0,
                nextRunAt: {
                  $add: [now, { $multiply: [{ $rand: {} }, spreadWindowMs] }],
                },
                updatedAt: now,
              },
            },
            {
              $unset: ["failReason", ...Object.keys(CLAIM_CLEANUP_FIELDS)],
            },
          ]),
      );

      const count = result.modifiedCount;

      if (count > 0) {
        yield* attempt(() => dependencies.emit("jobs:retried", { count }));

        const notification = yield* Effect.result(
          notifyRetriedPendingJobs(dependencies, filter, now),
        );

        if (Result.isFailure(notification)) {
          yield* attempt(() => {
            dependencies.emit("job:error", { error: toError(notification.failure) });
            dependencies.notifyPendingJob(filter.name, now);
          });
        }
      }

      return { count, errors: [] };
    }).pipe(Effect.mapError((failure) => jobMutationError(failure, "retryJobs", "retry jobs")));
  }, invalidate);

  const deleteJobs = Effect.fnUntraced(function* deleteMatchingJobs(
    filter: JobSelector,
  ): Effect.fn.Return<BulkOperationResult, unknown> {
    const query = yield* attempt(() => buildSelectorQuery(filter));

    // Use deleteMany for efficiency
    return yield* Effect.gen(function* writeDeletedJobs() {
      const result = yield* persist(async () => await dependencies.collection.deleteMany(query));

      if (result.deletedCount > 0) {
        yield* attempt(() => dependencies.emit("jobs:deleted", { count: result.deletedCount }));
      }

      return {
        count: result.deletedCount,
        errors: [],
      };
    }).pipe(Effect.mapError((failure) => jobMutationError(failure, "deleteJobs", "delete jobs")));
  }, invalidate);

  return {
    cancelJob,
    retryJob,
    rescheduleJob,
    setJobPriority,
    deleteJob,
    cancelJobs,
    retryJobs,
    deleteJobs,
  };
};

/** Semantic management Effects, composed once per initialized Scheduler Instance. @internal */
export class JobManagement extends Context.Service<
  JobManagement,
  ReturnType<typeof makeJobManagement>
>()("@monque/core/scheduler/JobManagement") {}

export const makeJobManagementLayer = (
  dependencies: JobManagementDependencies,
): Layer.Layer<JobManagement, never, JobQueries> =>
  Layer.effect(
    JobManagement,
    Effect.gen(function* acquireJobManagement() {
      return makeJobManagement(dependencies, yield* JobQueries);
    }),
  );
