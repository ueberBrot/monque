import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { type Document, ObjectId, type WithId } from "mongodb";

import { type BulkOperationResult, type JobSelector, JobStatus, type PersistedJob } from "@/jobs";
import {
  ConnectionError,
  InvalidJobPriorityError,
  JobStateError,
  MonqueError,
  toError,
} from "@/shared";
import { validateJobPriority } from "@/shared/utils/job-priority.js";

import { attempt, fromPromise } from "../effects.js";
import { buildSelectorQuery } from "../helpers.js";
import { CLAIM_CLEANUP_FIELDS } from "./job-lifecycle.js";
import {
  RETRYABLE_JOB_STATUSES,
  type RetryableJobStatusType,
  type SchedulerContext,
} from "./types.js";

type PendingNotificationDocument = Document & {
  name?: unknown;
  nextRunAt?: unknown;
};

type PendingJobEdit =
  | { action: "reschedule"; runAt: Date }
  | { action: "setJobPriority"; priority: number };

/**
 * Internal service for job lifecycle management operations.
 *
 * Provides atomic state transitions (cancel, retry, reschedule) and deletion.
 * Emits appropriate events on each operation.
 *
 * @internal Not part of public API - use Monque class methods instead.
 */
export class JobManager {
  constructor(private readonly ctx: SchedulerContext) {}

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
    function* (
      this: JobManager,
      jobId: string,
    ): Effect.fn.Return<PersistedJob<unknown> | null, unknown> {
      if (!ObjectId.isValid(jobId)) {
        return null;
      }

      const _id = new ObjectId(jobId);
      const now = yield* DateTime.nowAsDate;
      const result = yield* fromPromise(() =>
        this.ctx.collection.findOneAndUpdate(
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

      const jobDoc = yield* fromPromise(() => this.ctx.collection.findOne({ _id }));
      if (!jobDoc) {
        return null;
      }

      if (jobDoc["status"] === JobStatus.CANCELLED) {
        return yield* attempt(() => this.ctx.documentToPersistedJob(jobDoc));
      }

      return yield* Effect.fail(
        new JobStateError(
          `Cannot cancel job in status '${jobDoc["status"]}'`,
          jobId,
          jobDoc["status"],
          "cancel",
        ),
      );
    },
    Effect.mapError((error) => jobMutationError(error, "cancelJob", "cancel job")),
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
    function* (
      this: JobManager,
      jobId: string,
    ): Effect.fn.Return<PersistedJob<unknown> | null, unknown> {
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
      const result = yield* fromPromise(() =>
        this.ctx.collection.findOneAndUpdate(
          {
            _id,
            status: { $in: RETRYABLE_JOB_STATUSES },
          },
          update,
          { returnDocument: "before" },
        ),
      );

      if (!result) {
        const currentJob = yield* fromPromise(() => this.ctx.collection.findOne({ _id }));
        if (!currentJob) {
          return null;
        }

        return yield* Effect.fail(
          new JobStateError(
            `Cannot retry job in status '${currentJob["status"]}'`,
            jobId,
            currentJob["status"],
            "retry",
          ),
        );
      }

      const previousStatus = result["status"] as RetryableJobStatusType;
      const updatedDoc: WithId<Document> = { ...result, ...update.$set };
      for (const field of Object.keys(update.$unset)) {
        delete updatedDoc[field];
      }

      const job = yield* attempt(() => this.ctx.documentToPersistedJob(updatedDoc));
      yield* attempt(() => this.ctx.notifyPendingJob(job.name, job.nextRunAt));
      yield* attempt(() => this.ctx.emit("job:retried", { job, previousStatus }));
      return job;
    },
    Effect.mapError((error) => jobMutationError(error, "retryJob", "retry job")),
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
    function* (
      this: JobManager,
      jobId: string,
      runAt: Date,
    ): Effect.fn.Return<PersistedJob<unknown> | null, unknown> {
      return yield* this.editPendingJob(jobId, { action: "reschedule", runAt });
    },
    Effect.mapError((error) => jobMutationError(error, "rescheduleJob", "reschedule job")),
  );

  /** Atomically change priority on a pending Job, preserving schedule and ownership. */
  setJobPriority = Effect.fnUntraced(
    function* (
      this: JobManager,
      jobId: string,
      priority: number,
    ): Effect.fn.Return<PersistedJob<unknown> | null, unknown> {
      yield* attempt(() => {
        if (priority === undefined) throw new InvalidJobPriorityError();
        validateJobPriority(priority);
      });
      return yield* this.editPendingJob(jobId, { action: "setJobPriority", priority });
    },
    Effect.mapError((error) => jobMutationError(error, "setJobPriority", "change job priority")),
  );

  private editPendingJob = Effect.fnUntraced(function* (
    this: JobManager,
    jobId: string,
    edit: PendingJobEdit,
  ): Effect.fn.Return<PersistedJob<unknown> | null, unknown> {
    if (!ObjectId.isValid(jobId)) return null;
    const _id = new ObjectId(jobId);
    const now = yield* DateTime.nowAsDate;
    const fields =
      edit.action === "reschedule" ? { nextRunAt: edit.runAt } : { priority: edit.priority };
    const result = yield* fromPromise(() =>
      this.ctx.collection.findOneAndUpdate(
        { _id, status: JobStatus.PENDING },
        { $set: { ...fields, updatedAt: now } },
        { returnDocument: "after" },
      ),
    );
    if (result) {
      const job = yield* attempt(() => this.ctx.documentToPersistedJob(result));
      yield* attempt(() => this.ctx.notifyPendingJob(job.name, job.nextRunAt));
      return job;
    }
    const currentJob = yield* fromPromise(() => this.ctx.collection.findOne({ _id }));
    if (!currentJob) return null;
    const action = edit.action === "reschedule" ? "reschedule" : "change priority of";
    return yield* Effect.fail(
      new JobStateError(
        `Cannot ${action} job in status '${currentJob["status"]}'`,
        jobId,
        currentJob["status"],
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
    function* (this: JobManager, jobId: string): Effect.fn.Return<boolean, unknown> {
      if (!ObjectId.isValid(jobId)) return false;

      const _id = new ObjectId(jobId);

      const result = yield* fromPromise(() => this.ctx.collection.deleteOne({ _id }));

      if (result.deletedCount > 0) {
        yield* attempt(() => this.ctx.emit("job:deleted", { jobId }));
        return true;
      }

      return false;
    },
    Effect.mapError((error) => jobMutationError(error, "deleteJob", "delete job")),
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
  cancelJobs = Effect.fnUntraced(function* (
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

    return yield* Effect.gen({ self: this }, function* () {
      const now = yield* DateTime.nowAsDate;
      const result = yield* fromPromise(() =>
        this.ctx.collection.updateMany(query, {
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
    }).pipe(Effect.mapError((error) => jobMutationError(error, "cancelJobs", "cancel jobs")));
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
  retryJobs = Effect.fnUntraced(function* (
    this: JobManager,
    filter: JobSelector,
  ): Effect.fn.Return<BulkOperationResult, unknown> {
    const query = yield* attempt(() => buildSelectorQuery(filter));

    // Enforce allowed statuses, but respect explicit status filters
    if (filter.status !== undefined) {
      const requested = Array.isArray(filter.status) ? filter.status : [filter.status];
      const allowed = requested.filter((status): status is RetryableJobStatusType =>
        RETRYABLE_JOB_STATUSES.includes(status as RetryableJobStatusType),
      );
      if (allowed.length === 0) {
        return { count: 0, errors: [] };
      }
      query["status"] = allowed.length === 1 ? allowed[0] : { $in: allowed };
    } else {
      query["status"] = { $in: RETRYABLE_JOB_STATUSES };
    }

    const spreadWindowMs = 30_000; // 30s max spread for staggered retry

    return yield* Effect.gen({ self: this }, function* () {
      const now = yield* DateTime.nowAsDate;
      const result = yield* fromPromise(() =>
        this.ctx.collection.updateMany(query, [
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
    }).pipe(Effect.mapError((error) => jobMutationError(error, "retryJobs", "retry jobs")));
  });

  /**
   * Emits local Pending Notifications for Jobs moved back to pending by bulk retry.
   *
   * The bulk update uses MongoDB-side staggered `nextRunAt` values, so this reads back the
   * changed Jobs by their shared `updatedAt` timestamp to preserve precise wakeup times.
   */
  private notifyRetriedPendingJobs = Effect.fnUntraced(function* (
    this: JobManager,
    filter: JobSelector,
    updatedAt: Date,
  ): Effect.fn.Return<void, unknown> {
    // Retried Jobs are pending; retain only the original name and creation-date scope.
    const query = yield* attempt(() =>
      buildSelectorQuery({
        ...(filter.name === undefined ? {} : { name: filter.name }),
        ...(filter.olderThan === undefined ? {} : { olderThan: filter.olderThan }),
        ...(filter.newerThan === undefined ? {} : { newerThan: filter.newerThan }),
      }),
    );
    query["status"] = JobStatus.PENDING;
    query["updatedAt"] = updatedAt;
    const cursor = yield* attempt(() =>
      this.ctx.collection.find<PendingNotificationDocument>(query, {
        projection: { name: 1, nextRunAt: 1 },
      }),
    );
    let notified = false;
    yield* Stream.fromAsyncIterable(cursor, (error) => error).pipe(
      Stream.runForEach((job) =>
        attempt(() => {
          notified = true;
          const name = typeof job.name === "string" ? job.name : undefined;
          const nextRunAt = job.nextRunAt instanceof Date ? job.nextRunAt : updatedAt;
          this.ctx.notifyPendingJob(name, nextRunAt);
        }),
      ),
    );
    if (!notified) {
      yield* attempt(() => this.ctx.notifyPendingJob(filter.name, updatedAt));
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
  deleteJobs = Effect.fnUntraced(function* (
    this: JobManager,
    filter: JobSelector,
  ): Effect.fn.Return<BulkOperationResult, unknown> {
    const query = yield* attempt(() => buildSelectorQuery(filter));

    // Use deleteMany for efficiency
    return yield* Effect.gen({ self: this }, function* () {
      const result = yield* fromPromise(() => this.ctx.collection.deleteMany(query));

      if (result.deletedCount > 0) {
        yield* attempt(() => this.ctx.emit("jobs:deleted", { count: result.deletedCount }));
      }

      return {
        count: result.deletedCount,
        errors: [],
      };
    }).pipe(Effect.mapError((error) => jobMutationError(error, "deleteJobs", "delete jobs")));
  });
}

function jobMutationError(error: unknown, operation: string, action: string): MonqueError {
  if (error instanceof MonqueError) {
    return error;
  }
  const message = error instanceof Error ? error.message : `Unknown error during ${operation}`;
  return new ConnectionError(
    `Failed to ${action}: ${message}`,
    error instanceof Error ? { cause: error } : undefined,
  );
}
