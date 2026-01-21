import type { Job } from '@/jobs';

/**
 * Event payloads for Monque lifecycle events.
 */
export interface MonqueEventMap {
	/**
	 * Emitted when a job begins processing.
	 */
	'job:start': Job;

	/**
	 * Emitted when a job finishes successfully.
	 */
	'job:complete': {
		job: Job;
		/** Processing duration in milliseconds */
		duration: number;
	};

	/**
	 * Emitted when a job fails (may retry).
	 */
	'job:fail': {
		job: Job;
		error: Error;
		/** Whether the job will be retried */
		willRetry: boolean;
	};

	/**
	 * Emitted for unexpected errors during processing.
	 */
	'job:error': {
		error: Error;
		job?: Job;
	};

	/**
	 * Emitted when stale jobs are recovered on startup.
	 */
	'stale:recovered': {
		count: number;
	};

	/**
	 * Emitted when the change stream is successfully connected.
	 */
	'changestream:connected': undefined;

	/**
	 * Emitted when a change stream error occurs.
	 */
	'changestream:error': {
		error: Error;
	};

	/**
	 * Emitted when the change stream is closed.
	 */
	'changestream:closed': undefined;

	/**
	 * Emitted when falling back from change streams to polling-only mode.
	 */
	'changestream:fallback': {
		reason: string;
	};
	/**
	 * Emitted when a job is manually cancelled.
	 */
	'job:cancelled': {
		job: Job;
	};

	/**
	 * Emitted when a job is manually retried.
	 */
	'job:retried': {
		job: Job;
		previousStatus: 'failed' | 'cancelled';
	};

	/**
	 * Emitted when a job is manually deleted.
	 */
	'job:deleted': {
		jobId: string;
	};

	/**
	 * Emitted when multiple jobs are cancelled in bulk.
	 */
	'jobs:cancelled': {
		jobIds: string[];
		count: number;
	};

	/**
	 * Emitted when multiple jobs are retried in bulk.
	 */
	'jobs:retried': {
		jobIds: string[];
		count: number;
	};

	/**
	 * Emitted when multiple jobs are deleted in bulk.
	 */
	'jobs:deleted': {
		count: number;
	};
}
