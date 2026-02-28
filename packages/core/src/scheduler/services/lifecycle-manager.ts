import type { DeleteResult } from 'mongodb';

import { JobStatus } from '@/jobs';
import { toError } from '@/shared';

import type { SchedulerContext } from './types.js';

/**
 * Default retention check interval (1 hour).
 */
const DEFAULT_RETENTION_INTERVAL = 3600_000;

/**
 * Callbacks for timer-driven operations.
 *
 * These are provided by the Monque facade to wire LifecycleManager's timers
 * to JobProcessor methods without creating a direct dependency.
 */
interface TimerCallbacks {
	/** Poll for pending jobs */
	poll: () => Promise<void>;
	/** Update heartbeats for claimed jobs */
	updateHeartbeats: () => Promise<void>;
}

/**
 * Manages scheduler lifecycle timers and job cleanup.
 *
 * Owns poll interval, heartbeat interval, cleanup interval, and the
 * cleanupJobs logic. Extracted from Monque to keep the facade thin.
 *
 * @internal Not part of public API.
 */
export class LifecycleManager {
	private readonly ctx: SchedulerContext;
	private pollIntervalId: ReturnType<typeof setInterval> | null = null;
	private heartbeatIntervalId: ReturnType<typeof setInterval> | null = null;
	private cleanupIntervalId: ReturnType<typeof setInterval> | null = null;

	constructor(ctx: SchedulerContext) {
		this.ctx = ctx;
	}

	/**
	 * Start all lifecycle timers.
	 *
	 * Sets up poll interval, heartbeat interval, and (if configured)
	 * cleanup interval. Runs an initial poll immediately.
	 *
	 * @param callbacks - Functions to invoke on each timer tick
	 */
	startTimers(callbacks: TimerCallbacks): void {
		// Set up polling as backup (runs at configured interval)
		this.pollIntervalId = setInterval(() => {
			callbacks.poll().catch((error: unknown) => {
				this.ctx.emit('job:error', { error: toError(error) });
			});
		}, this.ctx.options.pollInterval);

		// Start heartbeat interval for claimed jobs
		this.heartbeatIntervalId = setInterval(() => {
			callbacks.updateHeartbeats().catch((error: unknown) => {
				this.ctx.emit('job:error', { error: toError(error) });
			});
		}, this.ctx.options.heartbeatInterval);

		// Start cleanup interval if retention is configured
		if (this.ctx.options.jobRetention) {
			const interval = this.ctx.options.jobRetention.interval ?? DEFAULT_RETENTION_INTERVAL;

			// Run immediately on start
			this.cleanupJobs().catch((error: unknown) => {
				this.ctx.emit('job:error', { error: toError(error) });
			});

			this.cleanupIntervalId = setInterval(() => {
				this.cleanupJobs().catch((error: unknown) => {
					this.ctx.emit('job:error', { error: toError(error) });
				});
			}, interval);
		}

		// Run initial poll immediately to pick up any existing jobs
		callbacks.poll().catch((error: unknown) => {
			this.ctx.emit('job:error', { error: toError(error) });
		});
	}

	/**
	 * Stop all lifecycle timers.
	 *
	 * Clears poll, heartbeat, and cleanup intervals.
	 */
	stopTimers(): void {
		if (this.cleanupIntervalId) {
			clearInterval(this.cleanupIntervalId);
			this.cleanupIntervalId = null;
		}

		if (this.pollIntervalId) {
			clearInterval(this.pollIntervalId);
			this.pollIntervalId = null;
		}

		if (this.heartbeatIntervalId) {
			clearInterval(this.heartbeatIntervalId);
			this.heartbeatIntervalId = null;
		}
	}

	/**
	 * Clean up old completed and failed jobs based on retention policy.
	 *
	 * - Removes completed jobs older than `jobRetention.completed`
	 * - Removes failed jobs older than `jobRetention.failed`
	 *
	 * The cleanup runs concurrently for both statuses if configured.
	 *
	 * @returns Promise resolving when all deletion operations complete
	 */
	async cleanupJobs(): Promise<void> {
		if (!this.ctx.options.jobRetention) {
			return;
		}

		const { completed, failed } = this.ctx.options.jobRetention;
		const now = Date.now();
		const deletions: Promise<DeleteResult>[] = [];

		if (completed != null) {
			const cutoff = new Date(now - completed);
			deletions.push(
				this.ctx.collection.deleteMany({
					status: JobStatus.COMPLETED,
					updatedAt: { $lt: cutoff },
				}),
			);
		}

		if (failed != null) {
			const cutoff = new Date(now - failed);
			deletions.push(
				this.ctx.collection.deleteMany({
					status: JobStatus.FAILED,
					updatedAt: { $lt: cutoff },
				}),
			);
		}

		if (deletions.length > 0) {
			await Promise.all(deletions);
		}
	}
}
