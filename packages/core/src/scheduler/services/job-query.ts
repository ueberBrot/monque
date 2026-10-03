import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import type { Document, ObjectId, WithId } from "mongodb";

import {
  type CursorOptions,
  type CursorPage,
  type GetJobsFilter,
  isValidJobStatus,
  type JobSelector,
  JobStatus,
  type JobSummaryPage,
  type PersistedJob,
  type QueueStats,
  type QueueViewSummary,
} from "@/jobs";
import {
  AggregationTimeoutError,
  ConnectionError,
  DEFAULT_MAX_BACKOFF_DELAY,
  InvalidJobQueryError,
  toError,
} from "@/shared";

import { attempt, fromPromise } from "../effects.js";
import { buildSelectorQuery, parseJobNameFilter, resolveQueryLimit } from "../helpers.js";
import { CursorListing } from "./cursor-listing.js";
import { QueryCache } from "./query-cache.js";
import type { SchedulerContext } from "./types.js";

const MONGO_MAX_TIME_MS_EXPIRED_CODE = 50;
type QueueViewStatsDocument = {
  _id: string;
  pending?: number;
  processing?: number;
  completed?: number;
  failed?: number;
  cancelled?: number;
  total?: number;
  completedDurationTotal?: number;
  completedDurationCount?: number;
};

function createEmptyQueueStats(): QueueStats {
  return {
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    total: 0,
  };
}

type MongoErrorWithTimeoutCode = Error & {
  code?: unknown;
  writeConcernError?: {
    code?: unknown;
  };
};
function isMongoMaxTimeMSExpiredError(error: Error): boolean {
  const mongoError = error as MongoErrorWithTimeoutCode;

  return (
    mongoError.code === MONGO_MAX_TIME_MS_EXPIRED_CODE ||
    mongoError.writeConcernError?.code === MONGO_MAX_TIME_MS_EXPIRED_CODE
  );
}

/**
 * Internal service for job query operations.
 *
 * Provides read-only access to jobs with filtering and cursor-based pagination.
 * All queries use efficient index-backed access patterns.
 *
 * @internal Not part of public API - use Monque class methods instead.
 */
export class JobQueryService {
  private readonly statsCache = new QueryCache<
    QueueStats,
    ConnectionError | AggregationTimeoutError
  >();
  private readonly queueViewCache = new QueryCache<
    ReadonlyMap<string, QueueStats>,
    ConnectionError | AggregationTimeoutError
  >();

  private readonly cursorListing: CursorListing;

  constructor(private readonly ctx: SchedulerContext) {
    this.cursorListing = new CursorListing(ctx);
  }

  /**
   * Get a single job by its MongoDB ObjectId.
   *
   * Useful for retrieving job details when you have a job ID from events,
   * logs, or stored references.
   *
   * @template T - The expected type of the job data payload
   * @param id - The job's ObjectId
   * @throws {ConnectionError} If scheduler not initialized
   *
   * @example Look up job from event
   * ```typescript
   * monque.on('job:fail', async ({ job }) => {
   *   // Later, retrieve the job to check its status
   *   const currentJob = await monque.getJob(job._id);
   *   console.log(`Job status: ${currentJob?.status}`);
   * });
   * ```
   *
   * @example Admin endpoint
   * ```typescript
   * app.get('/jobs/:id', async (req, res) => {
   *   const job = await monque.getJob(new ObjectId(req.params.id));
   *   if (!job) {
   *     return res.status(404).json({ error: 'Job not found' });
   *   }
   *   res.json(job);
   * });
   * ```
   */
  getJob = Effect.fnUntraced(function* <T = unknown>(
    this: JobQueryService,
    id: ObjectId,
  ): Effect.fn.Return<PersistedJob<T> | null, ConnectionError> {
    return yield* Effect.gen({ self: this }, function* () {
      const doc = yield* fromPromise(() => this.ctx.collection.findOne({ _id: id }));
      if (!doc) {
        return null;
      }
      return this.ctx.documentToPersistedJob<T>(doc as WithId<Document>);
    }).pipe(
      Effect.catchCause((cause) => {
        const error = Cause.squash(cause);
        const message = error instanceof Error ? error.message : "Unknown error during getJob";
        return Effect.fail(
          new ConnectionError(
            `Failed to get job: ${message}`,
            error instanceof Error ? { cause: error } : undefined,
          ),
        );
      }),
    );
  });

  /**
   * Query jobs from the queue with optional filters.
   *
   * Provides read-only access to job data for monitoring, debugging, and
   * administrative purposes. Results are ordered by `nextRunAt` ascending.
   *
   * @template T - The expected type of the job data payload
   * @param filter - Optional filter criteria
   * @throws {ConnectionError} If scheduler not initialized
   *
   * @example Get all pending jobs
   * ```typescript
   * const pendingJobs = await monque.getJobs({ status: JobStatus.PENDING });
   * console.log(`${pendingJobs.length} jobs waiting`);
   * ```
   *
   * @example Get failed email jobs
   * ```typescript
   * const failedEmails = await monque.getJobs({
   *   name: 'send-email',
   *   status: JobStatus.FAILED,
   * });
   * for (const job of failedEmails) {
   *   console.error(`Job ${job._id} failed: ${job.failReason}`);
   * }
   * ```
   *
   * @example Paginated job listing
   * ```typescript
   * const page1 = await monque.getJobs({ limit: 50, skip: 0 });
   * const page2 = await monque.getJobs({ limit: 50, skip: 50 });
   * ```
   *
   * @example Use with type guards from @monque/core
   * ```typescript
   * import { isPendingJob, isRecurringJob } from '@monque/core';
   *
   * const jobs = await monque.getJobs();
   * const pendingRecurring = jobs.filter(job => isPendingJob(job) && isRecurringJob(job));
   * ```
   */
  getJobs = Effect.fnUntraced(function* <T = unknown>(
    this: JobQueryService,
    filter: GetJobsFilter = {},
  ): Effect.fn.Return<PersistedJob<T>[], unknown> {
    const { query, limit, skip } = yield* attempt(() => {
      const query = buildSelectorQuery(filter);

      const limit = resolveQueryLimit(filter.limit, 100);
      const skip = filter.skip === undefined ? 0 : filter.skip;
      if (!Number.isSafeInteger(skip) || skip < 0) {
        throw new InvalidJobQueryError("skip must be a non-negative safe integer");
      }
      return { query, limit, skip };
    });

    return yield* Effect.gen({ self: this }, function* () {
      const docs = yield* fromPromise(() =>
        this.ctx.collection.find(query).sort({ nextRunAt: 1 }).skip(skip).limit(limit).toArray(),
      );

      return docs.map((doc) => this.ctx.documentToPersistedJob<T>(doc));
    }).pipe(
      Effect.catchCause((cause) => {
        const error = Cause.squash(cause);
        const message = error instanceof Error ? error.message : "Unknown error during getJobs";
        return Effect.fail(
          new ConnectionError(
            `Failed to query jobs: ${message}`,
            error instanceof Error ? { cause: error } : undefined,
          ),
        );
      }),
    );
  });

  /**
   * Get a paginated list of jobs using opaque cursors.
   *
   * Provides stable pagination for large job lists. Supports forward and backward
   * navigation, filtering, and efficient database access via index-based cursor queries.
   *
   * @template T - The job data payload type
   * @param options - Pagination options (cursor, limit, direction, filter)
   * @returns Page of jobs with next/prev cursors
   * @throws {InvalidCursorError} If the provided cursor is malformed
   * @throws {ConnectionError} If database operation fails or scheduler not initialized
   *
   * @example List pending jobs
   * ```typescript
   * const page = await monque.getJobsWithCursor({
   *   limit: 20,
   *   filter: { status: 'pending' }
   * });
   * const jobs = page.jobs;
   *
   * // Get next page
   * if (page.hasNextPage) {
   *   const page2 = await monque.getJobsWithCursor({
   *     cursor: page.cursor,
   *     limit: 20
   *   });
   * }
   * ```
   */

  getJobsWithCursor<T = unknown>(
    options: CursorOptions = {},
  ): Effect.Effect<CursorPage<T>, unknown> {
    return this.cursorListing.getJobsWithCursor<T>(options);
  }

  /** List job metadata using the same cursor as full listings, without reading payloads. */
  // Called through Monque in the public facade.
  // fallow-ignore-next-line unused-class-member
  getJobSummariesWithCursor(options: CursorOptions = {}): Effect.Effect<JobSummaryPage, unknown> {
    return this.cursorListing.getJobSummariesWithCursor(options);
  }

  /**
   * Clear statistics and Queue View snapshots, including in-flight cache writes.
   * Called on scheduler stop() for clean state on restart.
   * @internal
   */
  clearStatsCache(): void {
    this.statsCache.clear();
    this.queueViewCache.clear();
  }

  /**
   * Get aggregate statistics for the job queue.
   *
   * Uses MongoDB aggregation pipeline for efficient server-side calculation.
   * Returns counts per status and optional average processing duration for completed jobs.
   *
   * Results are cached per unique filter with a configurable TTL (default 5s).
   * Set `statsCacheTtlMs: 0` to disable caching.
   *
   * @param filter - Optional filter to scope statistics by job name
   * @throws {AggregationTimeoutError} If aggregation exceeds 30 second timeout
   * @throws {ConnectionError} If database operation fails
   *
   * @example Get overall queue statistics
   * ```typescript
   * const stats = await monque.getQueueStats();
   * console.log(`Pending: ${stats.pending}, Failed: ${stats.failed}`);
   * ```
   *
   * @example Get statistics for a specific job type
   * ```typescript
   * const emailStats = await monque.getQueueStats({ name: 'send-email' });
   * console.log(`${emailStats.total} email jobs in queue`);
   * ```
   */
  getQueueStats = Effect.fnUntraced(function* (
    this: JobQueryService,
    filter?: Pick<JobSelector, "name">,
  ): Effect.fn.Return<QueueStats, unknown> {
    const name = yield* attempt(() => parseJobNameFilter(filter === undefined ? {} : filter));
    const stats = yield* this.statsCache.get(name ?? "", this.ctx.options.statsCacheTtlMs, () =>
      this.loadQueueStats(name),
    );
    return { ...stats };
  });

  private loadQueueStats = Effect.fnUntraced(function* (
    this: JobQueryService,
    name?: string,
  ): Effect.fn.Return<QueueStats, ConnectionError | AggregationTimeoutError> {
    const pipeline: Document[] = [
      // Optional match stage for filtering by name
      ...(name === undefined ? [] : [{ $match: { name } }]),
      // Facet to calculate counts and avg processing duration in parallel
      {
        $facet: {
          // Count by status
          statusCounts: [
            {
              $group: {
                _id: "$status",
                count: { $sum: 1 },
              },
            },
          ],
          // Calculate average job lifetime for completed jobs.
          // Uses createdAt → updatedAt (total lifetime = queue wait + processing)
          // since completeJob() unsets lockedAt, making pure processing time unavailable.
          avgDuration: [
            {
              $match: {
                status: JobStatus.COMPLETED,
              },
            },
            {
              $group: {
                _id: null,
                avgMs: {
                  $avg: {
                    $subtract: ["$updatedAt", "$createdAt"],
                  },
                },
              },
            },
          ],
          // Total count
          total: [{ $count: "count" }],
        },
      },
    ];

    return yield* Effect.gen({ self: this }, function* () {
      const results = yield* fromPromise(() =>
        this.ctx.collection
          .aggregate<{
            statusCounts: Array<{ _id: string; count: number }>;
            total: Array<{ count: number }>;
            avgDuration: Array<{ avgMs: number | null }>;
          }>(pipeline, { maxTimeMS: 30000 })
          .toArray(),
      );

      const result = results[0];

      const stats = createEmptyQueueStats();
      if (!result) return stats;

      for (const { _id, count } of result.statusCounts) {
        if (isValidJobStatus(_id)) stats[_id] = count;
      }
      stats.total = result.total[0]?.count ?? 0;
      const avgMs = result.avgDuration[0]?.avgMs;
      if (typeof avgMs === "number" && !Number.isNaN(avgMs)) {
        stats.avgProcessingDurationMs = Math.round(avgMs);
      }

      return stats;
    }).pipe(
      Effect.catchCause((cause) => {
        const err = toError(Cause.squash(cause));

        if (isMongoMaxTimeMSExpiredError(err)) {
          return Effect.fail(new AggregationTimeoutError());
        }

        return Effect.fail(
          new ConnectionError(`Failed to get queue stats: ${err.message}`, { cause: err }),
        );
      }),
    );
  });

  /**
   * Get operator-facing Queue View summaries grouped by Job Name.
   *
   * Includes every persisted Job Name and every locally registered Worker name.
   * Summaries are sorted by Job Name and contain immutable statistics and Worker
   * observability snapshots.
   */
  getQueueViewSummaries = Effect.fnUntraced(function* (
    this: JobQueryService,
    filter?: Pick<JobSelector, "name">,
  ): Effect.fn.Return<readonly QueueViewSummary[], unknown> {
    const nameFilter = yield* attempt(() => parseJobNameFilter(filter === undefined ? {} : filter));
    const persistedStats = yield* this.queueViewCache.get(
      JSON.stringify(nameFilter ?? null),
      this.ctx.options.statsCacheTtlMs,
      () => this.loadQueueViewStats(nameFilter),
    );

    const workerNames =
      nameFilter === undefined
        ? this.ctx.workers.keys()
        : this.ctx.workers.has(nameFilter)
          ? [nameFilter]
          : [];
    const names = new Set([...persistedStats.keys(), ...workerNames]);
    const summaries = [...names]
      .sort((a, b) => a.localeCompare(b))
      .map((name): QueueViewSummary => {
        const worker = this.ctx.workers.get(name);
        const workerSummary = worker
          ? {
              concurrency: worker.concurrency,
              activeCount: worker.activeJobs.size,
              paused: this.ctx.isPaused(name),
              hasSchema: worker.schema !== undefined,
              maxRetries: worker.retryOptions?.maxRetries ?? this.ctx.options.maxRetries,
              baseRetryInterval:
                worker.retryOptions?.baseRetryInterval ?? this.ctx.options.baseRetryInterval,
              maxBackoffDelay:
                worker.retryOptions?.maxBackoffDelay ??
                this.ctx.options.maxBackoffDelay ??
                DEFAULT_MAX_BACKOFF_DELAY,
            }
          : null;

        return Object.freeze({
          name,
          hasPersistedJobs: persistedStats.has(name),
          hasRegisteredWorker: worker !== undefined,
          stats: Object.freeze({ ...(persistedStats.get(name) ?? createEmptyQueueStats()) }),
          worker: workerSummary ? Object.freeze(workerSummary) : null,
        });
      });

    return Object.freeze(summaries);
  });
  private loadQueueViewStats = Effect.fnUntraced(function* (
    this: JobQueryService,
    name?: string,
  ): Effect.fn.Return<ReadonlyMap<string, QueueStats>, ConnectionError | AggregationTimeoutError> {
    const persistedStats = new Map<string, QueueStats>();

    return yield* Effect.gen({ self: this }, function* () {
      const results = yield* fromPromise(() =>
        this.ctx.collection
          .aggregate<QueueViewStatsDocument>(
            [
              ...(name === undefined ? [] : [{ $match: { name } }]),
              {
                $group: {
                  _id: "$name",
                  pending: {
                    $sum: { $cond: [{ $eq: ["$status", JobStatus.PENDING] }, 1, 0] },
                  },
                  processing: {
                    $sum: { $cond: [{ $eq: ["$status", JobStatus.PROCESSING] }, 1, 0] },
                  },
                  completed: {
                    $sum: { $cond: [{ $eq: ["$status", JobStatus.COMPLETED] }, 1, 0] },
                  },
                  failed: {
                    $sum: { $cond: [{ $eq: ["$status", JobStatus.FAILED] }, 1, 0] },
                  },
                  cancelled: {
                    $sum: { $cond: [{ $eq: ["$status", JobStatus.CANCELLED] }, 1, 0] },
                  },
                  total: { $sum: 1 },
                  completedDurationTotal: {
                    $sum: {
                      $cond: [
                        { $eq: ["$status", JobStatus.COMPLETED] },
                        { $subtract: ["$updatedAt", "$createdAt"] },
                        0,
                      ],
                    },
                  },
                  completedDurationCount: {
                    $sum: { $cond: [{ $eq: ["$status", JobStatus.COMPLETED] }, 1, 0] },
                  },
                },
              },
            ],
            { maxTimeMS: 30000 },
          )
          .toArray(),
      );

      for (const result of results) {
        const stats: QueueStats = {
          pending: result.pending ?? 0,
          processing: result.processing ?? 0,
          completed: result.completed ?? 0,
          failed: result.failed ?? 0,
          cancelled: result.cancelled ?? 0,
          total: result.total ?? 0,
        };

        const completedDurationCount = result.completedDurationCount ?? 0;
        const completedDurationTotal = result.completedDurationTotal ?? 0;
        if (completedDurationCount > 0) {
          stats.avgProcessingDurationMs = Math.round(
            completedDurationTotal / completedDurationCount,
          );
        }

        persistedStats.set(result._id, stats);
      }
      return persistedStats;
    }).pipe(
      Effect.catchCause((cause) => {
        const err = toError(Cause.squash(cause));

        if (isMongoMaxTimeMSExpiredError(err)) {
          return Effect.fail(new AggregationTimeoutError());
        }

        return Effect.fail(
          new ConnectionError(`Failed to get queue view summaries: ${err.message}`, {
            cause: err,
          }),
        );
      }),
    );
  });
}
