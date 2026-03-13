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
	/** Whether change streams are currently active */
	isChangeStreamActive: () => boolean;
}

/**
 * Manages scheduler lifecycle timers and job cleanup.
 *
 * Owns poll scheduling, heartbeat interval, cleanup interval, and the
 * cleanupJobs logic. Extracted from Monque to keep the facade thin.
 *
 * Uses adaptive poll scheduling: when change streams are active, polls at
 * `safetyPollInterval` (safety net only). When change streams are inactive,
 * polls at `pollInterval` (primary discovery mechanism).
 *
 * @internal Not part of public API.
 */
export class LifecycleManager {
	private readonly ctx: SchedulerContext;
	private callbacks: TimerCallbacks | null = null;
	private pollTimeoutId: ReturnType<typeof setTimeout> | null = null;
	private heartbeatIntervalId: ReturnType<typeof setInterval> | null = null;
	private cleanupIntervalId: ReturnType<typeof setInterval> | null = null;

	constructor(ctx: SchedulerContext) {
		this.ctx = ctx;
	}

	/**
	 * Start all lifecycle timers.
	 *
	 * Sets up adaptive poll scheduling, heartbeat interval, and (if configured)
	 * cleanup interval. Runs an initial poll immediately.
	 *
	 * @param callbacks - Functions to invoke on each timer tick
	 */
	startTimers(callbacks: TimerCallbacks): void {
		this.callbacks = callbacks;

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

		// Run initial poll immediately, then schedule the next one adaptively
		this.executePollAndScheduleNext();
	}

	/**
	 * Stop all lifecycle timers.
	 *
	 * Clears poll timeout, heartbeat interval, and cleanup interval.
	 */
	stopTimers(): void {
		this.callbacks = null;

		if (this.cleanupIntervalId) {
			clearInterval(this.cleanupIntervalId);
			this.cleanupIntervalId = null;
		}

		if (this.pollTimeoutId) {
			clearTimeout(this.pollTimeoutId);
			this.pollTimeoutId = null;
		}

		if (this.heartbeatIntervalId) {
			clearInterval(this.heartbeatIntervalId);
			this.heartbeatIntervalId = null;
		}
	}

	/**
	 * Reset the poll timer to reschedule the next poll.
	 *
	 * Called after change-stream-triggered polls to ensure the safety poll timer
	 * is recalculated (not fired redundantly from an old schedule).
	 */
	resetPollTimer(): void {
		this.scheduleNextPoll();
	}

	/**
	 * Execute a poll and schedule the next one adaptively.
	 */
	private executePollAndScheduleNext(): void {
		if (!this.callbacks) {
			return;
		}

		this.callbacks
			.poll()
			.catch((error: unknown) => {
				this.ctx.emit('job:error', { error: toError(error) });
			})
			.then(() => {
				this.scheduleNextPoll();
			});
	}

	/**
	 * Schedule the next poll using adaptive timing.
	 *
	 * When change streams are active, uses `safetyPollInterval` (longer, safety net only).
	 * When change streams are inactive, uses `pollInterval` (shorter, primary discovery).
	 */
	private scheduleNextPoll(): void {
		if (this.pollTimeoutId) {
			clearTimeout(this.pollTimeoutId);
			this.pollTimeoutId = null;
		}

		if (!this.ctx.isRunning() || !this.callbacks) {
			return;
		}

		const delay = this.callbacks.isChangeStreamActive()
			? this.ctx.options.safetyPollInterval
			: this.ctx.options.pollInterval;

		this.pollTimeoutId = setTimeout(() => {
			this.executePollAndScheduleNext();
		}, delay);
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
