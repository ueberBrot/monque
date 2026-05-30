import type { Document, Filter, ObjectId, WithId } from 'mongodb';

import {
	CursorDirection,
	type CursorDirectionType,
	type CursorOptions,
	type CursorPage,
	type GetJobsFilter,
	type JobCursorSort,
	JobCursorSortDirection,
	JobCursorSortField,
	type JobSelector,
	JobStatus,
	type PersistedJob,
	type QueueStats,
	type QueueViewSummary,
	type QueueViewWorkerSummary,
} from '@/jobs';
import { AggregationTimeoutError, ConnectionError, InvalidCursorError, toError } from '@/shared';

import { buildSelectorQuery, decodeCursor, encodeCursor, normalizeCursorSort } from '../helpers.js';
import type { SchedulerContext } from './types.js';

interface StatsCacheEntry {
	data: QueueStats;
	expiresAt: number;
}

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

function freezeQueueStats(stats: QueueStats): Readonly<QueueStats> {
	return Object.freeze({ ...stats });
}

function freezeWorkerSummary(
	worker: QueueViewWorkerSummary | null,
): Readonly<QueueViewWorkerSummary> | null {
	if (!worker) {
		return null;
	}

	return Object.freeze({ ...worker });
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

function buildMongoSort(
	sort: JobCursorSort,
	direction: CursorDirectionType,
): Record<string, 1 | -1> {
	const baseDirection = sort.direction === JobCursorSortDirection.ASC ? 1 : -1;
	const effectiveDirection =
		direction === CursorDirection.FORWARD ? baseDirection : ((baseDirection * -1) as 1 | -1);

	if (sort.by === JobCursorSortField.IDENTIFIER) {
		return { _id: effectiveDirection };
	}

	return {
		[sort.by]: effectiveDirection,
		_id: effectiveDirection,
	};
}

function applyCursorConstraint(
	query: Filter<Document>,
	sort: JobCursorSort,
	direction: CursorDirectionType,
	anchorId: ObjectId | null,
	anchorSortValue: Date | null,
): void {
	if (!anchorId) {
		return;
	}

	const operator = getCursorOperator(sort, direction);

	if (sort.by === JobCursorSortField.IDENTIFIER) {
		query._id = { [operator]: anchorId };
		return;
	}

	if (!anchorSortValue) {
		throw new InvalidCursorError('Cursor does not match requested sort');
	}

	query.$or = [
		{ [sort.by]: { [operator]: anchorSortValue } },
		{ [sort.by]: anchorSortValue, _id: { [operator]: anchorId } },
	];
}

function getCursorOperator(sort: JobCursorSort, direction: CursorDirectionType): '$gt' | '$lt' {
	const isAscending = sort.direction === JobCursorSortDirection.ASC;
	const isForward = direction === CursorDirection.FORWARD;

	if ((isAscending && isForward) || (!isAscending && !isForward)) {
		return '$gt';
	}

	return '$lt';
}

function createPageCursor<T>(
	jobs: PersistedJob<T>[],
	direction: CursorDirectionType,
	sort: JobCursorSort,
): string | null {
	const lastJob = jobs[jobs.length - 1];

	if (!lastJob) {
		return null;
	}

	if (sort.by === JobCursorSortField.IDENTIFIER) {
		return encodeCursor(lastJob._id, direction, sort);
	}

	return encodeCursor(lastJob._id, direction, sort, lastJob[sort.by]);
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
	private readonly statsCache = new Map<string, StatsCacheEntry>();
	private static readonly MAX_CACHE_SIZE = 100;

	constructor(private readonly ctx: SchedulerContext) {}

	/**
	 * Get a single job by its MongoDB ObjectId.
	 *
	 * Useful for retrieving job details when you have a job ID from events,
	 * logs, or stored references.
	 *
	 * @template T - The expected type of the job data payload
	 * @param id - The job's ObjectId
	 * @returns Promise resolving to the job if found, null otherwise
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
	async getJob<T = unknown>(id: ObjectId): Promise<PersistedJob<T> | null> {
		try {
			const doc = await this.ctx.collection.findOne({ _id: id });
			if (!doc) {
				return null;
			}
			return this.ctx.documentToPersistedJob<T>(doc as WithId<Document>);
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error during getJob';
			throw new ConnectionError(
				`Failed to get job: ${message}`,
				error instanceof Error ? { cause: error } : undefined,
			);
		}
	}

	/**
	 * Query jobs from the queue with optional filters.
	 *
	 * Provides read-only access to job data for monitoring, debugging, and
	 * administrative purposes. Results are ordered by `nextRunAt` ascending.
	 *
	 * @template T - The expected type of the job data payload
	 * @param filter - Optional filter criteria
	 * @returns Promise resolving to array of matching jobs
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
	async getJobs<T = unknown>(filter: GetJobsFilter = {}): Promise<PersistedJob<T>[]> {
		const query: Document = {};

		if (filter.name !== undefined) {
			query['name'] = filter.name;
		}

		if (filter.status !== undefined) {
			if (Array.isArray(filter.status)) {
				query['status'] = { $in: filter.status };
			} else {
				query['status'] = filter.status;
			}
		}

		const limit = filter.limit ?? 100;
		const skip = filter.skip ?? 0;

		try {
			const cursor = this.ctx.collection.find(query).sort({ nextRunAt: 1 }).skip(skip).limit(limit);

			const docs = await cursor.toArray();
			return docs.map((doc) => this.ctx.documentToPersistedJob<T>(doc));
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error during getJobs';
			throw new ConnectionError(
				`Failed to query jobs: ${message}`,
				error instanceof Error ? { cause: error } : undefined,
			);
		}
	}

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
	async getJobsWithCursor<T = unknown>(options: CursorOptions = {}): Promise<CursorPage<T>> {
		const limit = options.limit ?? 50;
		const direction: CursorDirectionType = options.direction ?? CursorDirection.FORWARD;
		const sort = normalizeCursorSort(options.sort);
		let anchorId: ObjectId | null = null;
		let anchorSortValue: Date | null = null;

		if (options.cursor) {
			const decoded = decodeCursor(options.cursor);

			if (
				decoded.sort &&
				(decoded.sort.by !== sort.by || decoded.sort.direction !== sort.direction)
			) {
				throw new InvalidCursorError('Cursor does not match requested sort');
			}

			if (
				decoded.sort === undefined &&
				(sort.by !== JobCursorSortField.IDENTIFIER || sort.direction !== JobCursorSortDirection.ASC)
			) {
				throw new InvalidCursorError('Cursor does not match requested sort');
			}

			anchorId = decoded.id;
			anchorSortValue = decoded.sort?.value ?? null;
		}

		const query: Filter<Document> = options.filter ? buildSelectorQuery(options.filter) : {};
		const mongoSort = buildMongoSort(sort, direction);
		applyCursorConstraint(query, sort, direction, anchorId, anchorSortValue);
		const fetchLimit = limit + 1;

		let docs: WithId<Document>[];
		try {
			docs = await this.ctx.collection.find(query).sort(mongoSort).limit(fetchLimit).toArray();
		} catch (error) {
			const message =
				error instanceof Error ? error.message : 'Unknown error during getJobsWithCursor';
			throw new ConnectionError(
				`Failed to query jobs with cursor: ${message}`,
				error instanceof Error ? { cause: error } : undefined,
			);
		}

		let hasMore = false;
		if (docs.length > limit) {
			hasMore = true;
			docs.pop(); // Remove the extra item
		}

		if (direction === CursorDirection.BACKWARD) {
			docs.reverse();
		}

		const jobs = docs.map((doc) => this.ctx.documentToPersistedJob<T>(doc as WithId<Document>));

		const nextCursor = createPageCursor(jobs, direction, sort);

		let hasNextPage = false;
		let hasPreviousPage = false;

		// Determine availability of next/prev pages
		if (direction === CursorDirection.FORWARD) {
			hasNextPage = hasMore;
			hasPreviousPage = !!anchorId;
		} else {
			hasNextPage = !!anchorId;
			hasPreviousPage = hasMore;
		}

		return {
			jobs,
			cursor: nextCursor,
			hasNextPage,
			hasPreviousPage,
		};
	}

	/**
	 * Clear all cached getQueueStats() results.
	 * Called on scheduler stop() for clean state on restart.
	 * @internal
	 */
	clearStatsCache(): void {
		this.statsCache.clear();
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
	 * @returns Promise resolving to queue statistics
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
	async getQueueStats(filter?: Pick<JobSelector, 'name'>): Promise<QueueStats> {
		const ttl = this.ctx.options.statsCacheTtlMs;
		const cacheKey = filter?.name ?? '';

		if (ttl > 0) {
			const cached = this.statsCache.get(cacheKey);
			if (cached && cached.expiresAt > Date.now()) {
				return { ...cached.data };
			}
		}

		const matchStage: Document = {};

		if (filter?.name) {
			matchStage['name'] = filter.name;
		}

		const pipeline: Document[] = [
			// Optional match stage for filtering by name
			...(Object.keys(matchStage).length > 0 ? [{ $match: matchStage }] : []),
			// Facet to calculate counts and avg processing duration in parallel
			{
				$facet: {
					// Count by status
					statusCounts: [
						{
							$group: {
								_id: '$status',
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
										$subtract: ['$updatedAt', '$createdAt'],
									},
								},
							},
						},
					],
					// Total count
					total: [{ $count: 'count' }],
				},
			},
		];

		try {
			const results = await this.ctx.collection.aggregate(pipeline, { maxTimeMS: 30000 }).toArray();

			const result = results[0];

			// Initialize with zeros
			const stats: QueueStats = {
				pending: 0,
				processing: 0,
				completed: 0,
				failed: 0,
				cancelled: 0,
				total: 0,
			};

			if (result) {
				// Map status counts to stats
				const statusCounts = result['statusCounts'] as Array<{ _id: string; count: number }>;
				for (const entry of statusCounts) {
					const status = entry._id;
					const count = entry.count;

					switch (status) {
						case JobStatus.PENDING:
							stats.pending = count;
							break;
						case JobStatus.PROCESSING:
							stats.processing = count;
							break;
						case JobStatus.COMPLETED:
							stats.completed = count;
							break;
						case JobStatus.FAILED:
							stats.failed = count;
							break;
						case JobStatus.CANCELLED:
							stats.cancelled = count;
							break;
					}
				}

				// Extract total
				const totalResult = result['total'] as Array<{ count: number }>;
				if (totalResult.length > 0 && totalResult[0]) {
					stats.total = totalResult[0].count;
				}

				// Extract average processing duration
				const avgDurationResult = result['avgDuration'] as Array<{ avgMs: number }>;
				if (avgDurationResult.length > 0 && avgDurationResult[0]) {
					const avgMs = avgDurationResult[0].avgMs;
					if (typeof avgMs === 'number' && !Number.isNaN(avgMs)) {
						stats.avgProcessingDurationMs = Math.round(avgMs);
					}
				}
			}

			// Cache the result if TTL is enabled
			if (ttl > 0) {
				// Delete existing entry first so re-insertion moves it to end (Map insertion order = LRU)
				this.statsCache.delete(cacheKey);
				// LRU eviction: if cache is still full after removing existing key, evict the oldest entry
				if (this.statsCache.size >= JobQueryService.MAX_CACHE_SIZE) {
					const oldestKey = this.statsCache.keys().next().value;
					if (oldestKey !== undefined) {
						this.statsCache.delete(oldestKey);
					}
				}
				this.statsCache.set(cacheKey, {
					data: { ...stats },
					expiresAt: Date.now() + ttl,
				});
			}

			return stats;
		} catch (error) {
			const err = toError(error);

			if (isMongoMaxTimeMSExpiredError(err)) {
				throw new AggregationTimeoutError();
			}

			throw new ConnectionError(`Failed to get queue stats: ${err.message}`, { cause: err });
		}
	}

	/**
	 * Get operator-facing Queue View summaries grouped by Job Name.
	 *
	 * Includes every persisted Job Name and every locally registered Worker name.
	 * Summaries are sorted by Job Name and contain immutable statistics and Worker
	 * observability snapshots.
	 */
	async getQueueViewSummaries(): Promise<readonly QueueViewSummary[]> {
		const persistedStats = new Map<string, QueueStats>();

		try {
			const results = await this.ctx.collection
				.aggregate<QueueViewStatsDocument>(
					[
						{
							$group: {
								_id: '$name',
								pending: {
									$sum: { $cond: [{ $eq: ['$status', JobStatus.PENDING] }, 1, 0] },
								},
								processing: {
									$sum: { $cond: [{ $eq: ['$status', JobStatus.PROCESSING] }, 1, 0] },
								},
								completed: {
									$sum: { $cond: [{ $eq: ['$status', JobStatus.COMPLETED] }, 1, 0] },
								},
								failed: {
									$sum: { $cond: [{ $eq: ['$status', JobStatus.FAILED] }, 1, 0] },
								},
								cancelled: {
									$sum: { $cond: [{ $eq: ['$status', JobStatus.CANCELLED] }, 1, 0] },
								},
								total: { $sum: 1 },
								completedDurationTotal: {
									$sum: {
										$cond: [
											{ $eq: ['$status', JobStatus.COMPLETED] },
											{ $subtract: ['$updatedAt', '$createdAt'] },
											0,
										],
									},
								},
								completedDurationCount: {
									$sum: { $cond: [{ $eq: ['$status', JobStatus.COMPLETED] }, 1, 0] },
								},
							},
						},
					],
					{ maxTimeMS: 30000 },
				)
				.toArray();

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
		} catch (error) {
			const err = toError(error);

			if (isMongoMaxTimeMSExpiredError(err)) {
				throw new AggregationTimeoutError();
			}

			throw new ConnectionError(`Failed to get queue view summaries: ${err.message}`, {
				cause: err,
			});
		}

		const names = new Set([...persistedStats.keys(), ...this.ctx.workers.keys()]);
		const summaries = [...names]
			.sort((a, b) => a.localeCompare(b))
			.map((name): QueueViewSummary => {
				const worker = this.ctx.workers.get(name);
				const workerSummary = worker
					? {
							concurrency: worker.concurrency,
							activeCount: worker.activeJobs.size,
						}
					: null;

				return Object.freeze({
					name,
					hasPersistedJobs: persistedStats.has(name),
					hasRegisteredWorker: worker !== undefined,
					stats: freezeQueueStats(persistedStats.get(name) ?? createEmptyQueueStats()),
					worker: freezeWorkerSummary(workerSummary),
				});
			});

		return Object.freeze(summaries);
	}
}
