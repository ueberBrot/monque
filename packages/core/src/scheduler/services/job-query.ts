import type { Document, Filter, ObjectId, WithId } from 'mongodb';

import {
	CursorDirection,
	type CursorDirectionType,
	type CursorOptions,
	type CursorPage,
	type GetJobsFilter,
	type JobSelector,
	JobStatus,
	type PersistedJob,
	type QueueStats,
} from '@/jobs';
import { AggregationTimeoutError, ConnectionError } from '@/shared';

import { buildSelectorQuery, decodeCursor, encodeCursor } from '../helpers.js';
import type { SchedulerContext } from './types.js';

/**
 * Internal service for job query operations.
 *
 * Provides read-only access to jobs with filtering and cursor-based pagination.
 * All queries use efficient index-backed access patterns.
 *
 * @internal Not part of public API - use Monque class methods instead.
 */
export class JobQueryService {
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
		// Default to forward if not specified.
		const direction: CursorDirectionType = options.direction ?? CursorDirection.FORWARD;
		let anchorId: ObjectId | null = null;

		if (options.cursor) {
			const decoded = decodeCursor(options.cursor);
			anchorId = decoded.id;
		}

		// Build base query from filters
		const query: Filter<Document> = options.filter ? buildSelectorQuery(options.filter) : {};

		// Add cursor condition to query
		const sortDir = direction === CursorDirection.FORWARD ? 1 : -1;

		if (anchorId) {
			if (direction === CursorDirection.FORWARD) {
				query._id = { ...query._id, $gt: anchorId };
			} else {
				query._id = { ...query._id, $lt: anchorId };
			}
		}

		// Fetch limit + 1 to detect hasNext/hasPrev
		const fetchLimit = limit + 1;

		// Sort: Always deterministic.
		const docs = await this.ctx.collection
			.find(query)
			.sort({ _id: sortDir })
			.limit(fetchLimit)
			.toArray();

		let hasMore = false;
		if (docs.length > limit) {
			hasMore = true;
			docs.pop(); // Remove the extra item
		}

		if (direction === CursorDirection.BACKWARD) {
			docs.reverse();
		}

		const jobs = docs.map((doc) => this.ctx.documentToPersistedJob<T>(doc as WithId<Document>));

		let nextCursor: string | null = null;

		if (jobs.length > 0) {
			const lastJob = jobs[jobs.length - 1];
			// Check for existence to satisfy strict null checks/noUncheckedIndexedAccess
			if (lastJob) {
				nextCursor = encodeCursor(lastJob._id, direction);
			}
		}

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
	 * Get aggregate statistics for the job queue.
	 *
	 * Uses MongoDB aggregation pipeline for efficient server-side calculation.
	 * Returns counts per status and optional average processing duration for completed jobs.
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
					// Calculate average processing duration for completed jobs
					avgDuration: [
						{
							$match: {
								status: JobStatus.COMPLETED,
								lockedAt: { $ne: null },
							},
						},
						{
							$group: {
								_id: null,
								avgMs: {
									$avg: {
										$subtract: ['$updatedAt', '$lockedAt'],
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

			if (!result) {
				return stats;
			}

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

			return stats;
		} catch (error) {
			// Check for timeout error
			if (error instanceof Error && error.message.includes('exceeded time limit')) {
				throw new AggregationTimeoutError();
			}

			const message = error instanceof Error ? error.message : 'Unknown error during getQueueStats';
			throw new ConnectionError(
				`Failed to get queue stats: ${message}`,
				error instanceof Error ? { cause: error } : undefined,
			);
		}
	}
}
