/**
 * Management APIs TypeScript Contracts
 *
 * This file contains the complete type definitions for the Management APIs feature.
 * These are the exact interfaces that will be added to @monque/core.
 *
 * @packageDocumentation
 */

import type { ObjectId } from 'mongodb';

// =============================================================================
// Job Status Extension
// =============================================================================

/**
 * Extended JobStatus with 'cancelled' state.
 */
export const JobStatus = {
	PENDING: 'pending',
	PROCESSING: 'processing',
	COMPLETED: 'completed',
	FAILED: 'failed',
	CANCELLED: 'cancelled',
} as const;

export type JobStatusType = (typeof JobStatus)[keyof typeof JobStatus];

// =============================================================================
// Cursor Direction
// =============================================================================

export const CursorDirection = {
	FORWARD: 'forward',
	BACKWARD: 'backward',
} as const;

export type CursorDirectionType = (typeof CursorDirection)[keyof typeof CursorDirection];

// =============================================================================
// Filter Types
// =============================================================================

/**
 * Filter options for bulk operations.
 */
export interface JobSelector {
	/** Filter by job type name */
	name?: string;

	/** Filter by status (single or multiple) */
	status?: JobStatusType | JobStatusType[];

	/** Filter jobs created before this date */
	olderThan?: Date;

	/** Filter jobs created after this date */
	newerThan?: Date;
}

// =============================================================================
// Pagination Types
// =============================================================================

/**
 * Options for cursor-based pagination.
 */
export interface CursorOptions {
	/** Opaque cursor from previous query */
	cursor?: string;

	/** Maximum jobs per page (default: 50) */
	limit?: number;

	/** Pagination direction (default: forward) */
	direction?: CursorDirectionType;

	/** Optional filters to apply */
	filter?: {
		name?: string;
		status?: JobStatusType | JobStatusType[];
	};
}

/**
 * Paginated response with cursor for stable iteration.
 */
export interface CursorPage<T = unknown> {
	/** Jobs in this page */
	jobs: PersistedJob<T>[];

	/** Cursor for next/previous page, null if no more results */
	cursor: string | null;

	/** Whether more results exist in forward direction */
	hasNextPage: boolean;

	/** Whether results exist in backward direction */
	hasPreviousPage: boolean;
}

// =============================================================================
// Statistics Types
// =============================================================================

/**
 * Aggregate statistics for the job queue.
 */
export interface QueueStats {
	/** Count of pending jobs */
	pending: number;

	/** Count of processing jobs */
	processing: number;

	/** Count of completed jobs */
	completed: number;

	/** Count of failed jobs */
	failed: number;

	/** Count of cancelled jobs */
	cancelled: number;

	/** Total job count (sum of all statuses) */
	total: number;

	/** Average processing duration in milliseconds (completed jobs only) */
	avgProcessingDurationMs?: number;
}

// =============================================================================
// Bulk Operation Types
// =============================================================================

/**
 * Result of a bulk operation (cancel/retry).
 */
export interface BulkOperationResult {
	/** Number of jobs successfully affected */
	count: number;

	/** Errors for jobs that could not be processed */
	errors: Array<{
		jobId: string;
		error: string;
	}>;
}

// =============================================================================
// Job Types (for reference)
// =============================================================================

/**
 * Job interface (existing, shown for context).
 */
export interface Job<T = unknown> {
	_id?: ObjectId;
	name: string;
	data: T;
	status: JobStatusType;
	nextRunAt: Date;
	lockedAt?: Date | null;
	claimedBy?: string | null;
	lastHeartbeat?: Date | null;
	heartbeatInterval?: number;
	failCount: number;
	failReason?: string;
	repeatInterval?: string;
	uniqueKey?: string;
	createdAt: Date;
	updatedAt: Date;
}

/**
 * Persisted job with guaranteed _id.
 */
export type PersistedJob<T = unknown> = Job<T> & { _id: ObjectId };

// =============================================================================
// Event Types
// =============================================================================

/**
 * New events added to MonqueEventMap.
 */
export interface ManagementEventMap {
	'job:cancelled': {
		job: Job;
	};

	'job:retried': {
		job: Job;
		previousStatus: 'failed' | 'cancelled';
	};
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Error thrown when a job cannot transition to the requested state.
 */
export interface JobStateErrorData {
	name: 'JobStateError';
	message: string;
	jobId: string;
	currentStatus: string;
	attemptedAction: 'cancel' | 'retry' | 'delete';
}

/**
 * Error thrown when a pagination cursor is invalid or expired.
 */
export interface InvalidCursorErrorData {
	name: 'InvalidCursorError';
	message: string;
}

// =============================================================================
// Method Signatures
// =============================================================================

/**
 * Management API method signatures for Monque class.
 */
export interface MonqueManagementMethods {
	// Single job operations
	cancelJob(id: ObjectId): Promise<PersistedJob | null>;
	retryJob(id: ObjectId): Promise<PersistedJob | null>;
	rescheduleJob(id: ObjectId, runAt: Date): Promise<PersistedJob | null>;
	deleteJob(id: ObjectId): Promise<boolean>;

	// Bulk operations
	cancelJobs(filter: JobSelector): Promise<BulkOperationResult>;
	retryJobs(filter: JobSelector): Promise<BulkOperationResult>;
	deleteJobs(filter: JobSelector): Promise<number>;

	// Pagination & statistics
	getJobsWithCursor<T = unknown>(options?: CursorOptions): Promise<CursorPage<T>>;
	getQueueStats(filter?: Pick<JobSelector, 'name'>): Promise<QueueStats>;
}
