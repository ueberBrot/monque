import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Stream from "effect/Stream";
import { ObjectId } from "mongodb";
import type { Document, WithId } from "mongodb";

import { JobStatus } from "@/jobs";
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

import { attempt, fromPromise } from "../effects.js";
import { buildSelectorQuery } from "../helpers.js";
import { CLAIM_CLEANUP_FIELDS } from "./job-lifecycle.js";
import { RETRYABLE_JOB_STATUSES } from "./types.js";
import type { RetryableJobStatusType, SchedulerContext } from "./types.js";

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Native database failures may be arbitrary values; preserve MonqueError identity and legacy fallback messages.
const jobMutationError = (error: unknown, operation: string, action: string): MonqueError => {
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
/**
 * Internal service for job lifecycle management operations.
 *
 * Provides atomic state transitions (cancel, retry, reschedule) and deletion.
 * Emits appropriate events on each operation.
 *
 * Not part of public API - use Monque class methods instead.
 * @internal
 */
export class JobManager {
  private readonly ctx: SchedulerContext;
  constructor(ctx: SchedulerContext) {
    this.ctx = ctx;
  }
  /**
   * Cancel a pending or scheduled job.
   *
   * Atomically sets a pending job's status to 'cancelled'.
   * Cancellation is idempotent: no-op cancels may return null.
   * Emits a 'job:cancelled' event only when a real transition occurs.
   * Cannot cancel jobs that are currently 'processing', 'completed', or 'failed'.
   *
   * @param jobId - The ID of the job to cancel
   * @returns The cancelled job, or null if not found or cancellation is a no-op
   * @throws {JobStateError} If job is in an invalid state for cancellation
   *
   * @example Cancel a pending job
   * ```typescript
   * const job = await monque.enqueue('report', { type: 'daily' });
   * await monque.cancelJob(job._id.toString());
   * ```
   */
  cancelJob = Effect.fnUntraced(
    function* cancelSingleJob(
      this: JobManager,
      jobId: string,
    ): Effect.fn.Return<PersistedJob | null, unknown> {
      if (!ObjectId.isValid(jobId)) {
        return null;
      }
      const _id = new ObjectId(jobId);
      const now = yield* DateTime.nowAsDate;
      const result = yield* fromPromise(
        async () =>
          await this.ctx.collection.findOneAndUpdate(
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
        const job = yield* attempt(() => this.ctx.documentToPersistedJob(result));
        yield* attempt(() => this.ctx.emit("job:cancelled", { job }));
        return job;
      }
      const jobDoc = yield* fromPromise(
        async () => await this.ctx.collection.findOne<WithId<{ status: string }>>({ _id }),
      );
      if (!jobDoc) {
        return null;
      }
      if (jobDoc.status === JobStatus.CANCELLED) {
        return yield* attempt(() => this.ctx.documentToPersistedJob(jobDoc));
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
  );
  /**
   * Retry a failed or cancelled job.
   *
   * Resets the job to 'pending' status, clears failure count/reason, and sets
   * nextRunAt to now (immediate retry). Emits a 'job:retried' event.
   *
   * @param jobId - The ID of the job to retry
   * @returns The updated job, or null if not found
   * @throws {JobStateError} If job is in an invalid state for retry (must be failed or cancelled)
   *
   * @example Retry a failed job
   * ```typescript
   * monque.on('job:fail', async ({ job }) => {
   *   console.log(`Job ${job._id} failed, retrying manually...`);
   *   await monque.retryJob(job._id.toString());
   * });
   * ```
   */
  retryJob = Effect.fnUntraced(
    function* retrySingleJob(
      this: JobManager,
      jobId: string,
    ): Effect.fn.Return<PersistedJob | null, unknown> {
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
      const result = yield* fromPromise(
        async () =>
          await this.ctx.collection.findOneAndUpdate(
            {
              _id,
              status: { $in: RETRYABLE_JOB_STATUSES },
            },
            update,
            { returnDocument: "before" },
          ),
      );
      if (!result) {
        const currentJob = yield* fromPromise(
          async () => await this.ctx.collection.findOne<WithId<{ status: string }>>({ _id }),
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
      const job = yield* attempt(() => this.ctx.documentToPersistedJob(updatedDoc));
      yield* attempt(() => {
        this.ctx.notifyPendingJob(job.name, job.nextRunAt);
      });
      yield* attempt(() => this.ctx.emit("job:retried", { job, previousStatus }));
      return job;
    },
    Effect.mapError((failure) => jobMutationError(failure, "retryJob", "retry job")),
  );
  /**
   * Reschedule a pending job to run at a different time.
   *
   * Only works for jobs in 'pending' status.
   *
   * @param jobId - The ID of the job to reschedule
   * @param runAt - The new Date when the job should run
   * @returns The updated job, or null if not found
   * @throws {JobStateError} If job is not in pending state
   *
   * @example Delay a job by 1 hour
   * ```typescript
   * const nextHour = new Date(Date.now() + 60 * 60 * 1000);
   * await monque.rescheduleJob(jobId, nextHour);
   * ```
   */
  rescheduleJob = Effect.fnUntraced(
    function* rescheduleSingleJob(
      this: JobManager,
      jobId: string,
      runAt: Date,
    ): Effect.fn.Return<PersistedJob | null, unknown> {
      return yield* this.editPendingJob(jobId, { action: "reschedule", runAt });
    },
    Effect.mapError((failure) => jobMutationError(failure, "rescheduleJob", "reschedule job")),
  );
  /** Atomically change priority on a pending Job, preserving schedule and ownership. */
  setJobPriority = Effect.fnUntraced(
    function* setSingleJobPriority(
      this: JobManager,
      jobId: string,
      priority: number,
    ): Effect.fn.Return<PersistedJob | null, unknown> {
      yield* attempt(() => {
        if (priority === undefined) {
          throw new InvalidJobPriorityError();
        }
        validateJobPriority(priority);
      });
      return yield* this.editPendingJob(jobId, { action: "setJobPriority", priority });
    },
    Effect.mapError((failure) =>
      jobMutationError(failure, "setJobPriority", "change job priority"),
    ),
  );
  private readonly editPendingJob = Effect.fnUntraced(function* editSinglePendingJob(
    this: JobManager,
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
    const result = yield* fromPromise(
      async () =>
        await this.ctx.collection.findOneAndUpdate(
          { _id, status: JobStatus.PENDING },
          { $set: { ...fields, updatedAt: now } },
          { returnDocument: "after" },
        ),
    );
    if (result) {
      const job = yield* attempt(() => this.ctx.documentToPersistedJob(result));
      yield* attempt(() => {
        this.ctx.notifyPendingJob(job.name, job.nextRunAt);
      });
      return job;
    }
    const currentJob = yield* fromPromise(
      async () => await this.ctx.collection.findOne<WithId<{ status: string }>>({ _id }),
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
  /**
   * Permanently delete a job.
   *
   * This action is irreversible. Emits a 'job:deleted' event upon success.
   * Can delete a job in any state.
   *
   * @param jobId - The ID of the job to delete
   * @returns true if deleted, false if job not found
   *
   * @example Delete a cleanup job
   * ```typescript
   * const deleted = await monque.deleteJob(jobId);
   * if (deleted) {
   *   console.log('Job permanently removed');
   * }
   * ```
   */
  deleteJob = Effect.fnUntraced(
    function* deleteSingleJob(this: JobManager, jobId: string): Effect.fn.Return<boolean, unknown> {
      if (!ObjectId.isValid(jobId)) {
        return false;
      }
      const _id = new ObjectId(jobId);
      const result = yield* fromPromise(async () => await this.ctx.collection.deleteOne({ _id }));
      if (result.deletedCount > 0) {
        yield* attempt(() => this.ctx.emit("job:deleted", { jobId }));
        return true;
      }
      return false;
    },
    Effect.mapError((failure) => jobMutationError(failure, "deleteJob", "delete job")),
  );
  // ─────────────────────────────────────────────────────────────────────────────
  // Bulk Operations
  // ─────────────────────────────────────────────────────────────────────────────
  /**
   * Cancel multiple jobs matching the given filter via a single updateMany call.
   *
   * Only cancels jobs in 'pending' status — the status guard is applied regardless
   * of what the filter specifies. Jobs in other states are silently skipped (not
   * matched by the query). Emits a 'jobs:cancelled' event with the count of
   * successfully cancelled jobs.
   *
   * @param filter - Selector for which jobs to cancel (name, status, date range)
   * @returns Result with count of cancelled jobs (errors array always empty for bulk ops)
   *
   * @example Cancel all pending jobs for a queue
   * ```typescript
   * const result = await monque.cancelJobs({
   *   name: 'email-queue',
   *   status: 'pending'
   * });
   * console.log(`Cancelled ${result.count} jobs`);
   * ```
   */
  cancelJobs = Effect.fnUntraced(function* cancelMatchingJobs(
    this: JobManager,
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
    return yield* Effect.gen({ self: this }, function* writeCancelledJobs() {
      const now = yield* DateTime.nowAsDate;
      const result = yield* fromPromise(
        async () =>
          await this.ctx.collection.updateMany(query, {
            $set: {
              status: JobStatus.CANCELLED,
              updatedAt: now,
            },
          }),
      );
      const count = result.modifiedCount;
      if (count > 0) {
        yield* attempt(() => this.ctx.emit("jobs:cancelled", { count }));
      }
      return { count, errors: [] };
    }).pipe(Effect.mapError((failure) => jobMutationError(failure, "cancelJobs", "cancel jobs")));
  });
  /**
   * Retry multiple jobs matching the given filter via a single pipeline-style updateMany call.
   *
   * Only retries jobs in 'failed' or 'cancelled' status — the status guard is applied
   * regardless of what the filter specifies. Jobs in other states are silently skipped.
   * Uses `$rand` for per-document staggered `nextRunAt` to avoid thundering herd on retry.
   * Emits a 'jobs:retried' event with the count of successfully retried jobs.
   *
   * @param filter - Selector for which jobs to retry (name, status, date range)
   * @returns Result with count of retried jobs (errors array always empty for bulk ops)
   *
   * @example Retry all failed jobs
   * ```typescript
   * const result = await monque.retryJobs({
   *   status: 'failed'
   * });
   * console.log(`Retried ${result.count} jobs`);
   * ```
   */
  retryJobs = Effect.fnUntraced(function* retryMatchingJobs(
    this: JobManager,
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
    return yield* Effect.gen({ self: this }, function* writeRetriedJobs() {
      const now = yield* DateTime.nowAsDate;
      const result = yield* fromPromise(
        async () =>
          await this.ctx.collection.updateMany(query, [
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
        yield* attempt(() => this.ctx.emit("jobs:retried", { count }));
        yield* this.notifyRetriedPendingJobs(filter, now).pipe(
          Effect.catch((error) =>
            attempt(() => {
              this.ctx.emit("job:error", { error: toError(error) });
              this.ctx.notifyPendingJob(filter.name, now);
            }),
          ),
        );
      }
      return { count, errors: [] };
    }).pipe(Effect.mapError((failure) => jobMutationError(failure, "retryJobs", "retry jobs")));
  });
  /**
   * Emits local Pending Notifications for Jobs moved back to pending by bulk retry.
   *
   * The bulk update uses MongoDB-side staggered `nextRunAt` values, so this reads back the
   * changed Jobs by their shared `updatedAt` timestamp to preserve precise wakeup times.
   */
  private readonly notifyRetriedPendingJobs = Effect.fnUntraced(function* notifyRetriedJobs(
    this: JobManager,
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
      const { collection } = this.ctx;
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
          this.ctx.notifyPendingJob(name, nextRunAt);
        }),
      ),
    );
    if (!notified) {
      yield* attempt(() => {
        this.ctx.notifyPendingJob(filter.name, updatedAt);
      });
    }
  });
  /**
   * Delete multiple jobs matching the given filter.
   *
   * Deletes jobs in any status. Uses a batch delete for efficiency.
   * Emits a 'jobs:deleted' event with the count of deleted jobs.
   * Does not emit individual 'job:deleted' events to avoid noise.
   *
   * @param filter - Selector for which jobs to delete (name, status, date range)
   * @returns Result with count of deleted jobs (errors array always empty for delete)
   *
   * @example Delete old completed jobs
   * ```typescript
   * const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
   * const result = await monque.deleteJobs({
   *   status: 'completed',
   *   olderThan: weekAgo
   * });
   * console.log(`Deleted ${result.count} jobs`);
   * ```
   */
  deleteJobs = Effect.fnUntraced(function* deleteMatchingJobs(
    this: JobManager,
    filter: JobSelector,
  ): Effect.fn.Return<BulkOperationResult, unknown> {
    const query = yield* attempt(() => buildSelectorQuery(filter));
    // Use deleteMany for efficiency
    return yield* Effect.gen({ self: this }, function* writeDeletedJobs() {
      const result = yield* fromPromise(async () => await this.ctx.collection.deleteMany(query));
      if (result.deletedCount > 0) {
        yield* attempt(() => this.ctx.emit("jobs:deleted", { count: result.deletedCount }));
      }
      return {
        count: result.deletedCount,
        errors: [],
      };
    }).pipe(Effect.mapError((failure) => jobMutationError(failure, "deleteJobs", "delete jobs")));
  });
}
