import type { ChangeStream, ChangeStreamDocument, Document } from 'mongodb';

import { JobStatus } from '@/jobs';
import { toError } from '@/shared';

import type { SchedulerContext } from './types.js';

/** Minimum poll interval floor to prevent tight loops (ms) */
const MIN_POLL_INTERVAL = 100;

/** Grace period after nextRunAt before scheduling a wakeup poll (ms) */
const POLL_GRACE_PERIOD = 200;

/**
 * Internal service for MongoDB Change Stream lifecycle.
 *
 * Provides real-time job notifications when available, with automatic
 * reconnection and graceful fallback to polling-only mode.
 *
 * Leverages the full document from change stream events to:
 * - Trigger **targeted polls** for specific workers (using the job `name`)
 * - Schedule **precise wakeup timers** for future-dated jobs (using `nextRunAt`)
 *
 * @internal Not part of public API.
 */
export class ChangeStreamHandler {
	/** MongoDB Change Stream for real-time job notifications */
	private changeStream: ChangeStream | null = null;

	/** Number of consecutive reconnection attempts */
	private reconnectAttempts = 0;

	/** Maximum reconnection attempts before falling back to polling-only mode */
	private readonly maxReconnectAttempts = 3;

	/** Debounce timer for change stream event processing */
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;

	/** Timer ID for reconnection with exponential backoff */
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

	/** Whether the scheduler is currently using change streams */
	private usingChangeStreams = false;

	/** Job names collected during the current debounce window for targeted polling */
	private pendingTargetNames: Set<string> = new Set();

	/** Wakeup timer for the earliest known future job */
	private wakeupTimer: ReturnType<typeof setTimeout> | null = null;

	/** Time of the currently scheduled wakeup */
	private wakeupTime: Date | null = null;

	constructor(
		private readonly ctx: SchedulerContext,
		private readonly onPoll: (targetNames?: ReadonlySet<string>) => Promise<void>,
	) {}

	/**
	 * Set up MongoDB Change Stream for real-time job notifications.
	 *
	 * Change streams provide instant notifications when jobs are inserted or when
	 * job status changes to pending (e.g., after a retry). This eliminates the
	 * polling delay for reactive job processing.
	 *
	 * The change stream watches for:
	 * - Insert operations (new jobs)
	 * - Update operations where status field changes
	 *
	 * If change streams are unavailable (e.g., standalone MongoDB), the system
	 * gracefully falls back to polling-only mode.
	 */
	setup(): void {
		if (!this.ctx.isRunning()) {
			return;
		}

		this.clearReconnectTimer();

		try {
			// Create change stream with pipeline to filter relevant events
			const pipeline = [
				{
					$match: {
						$or: [
							{ operationType: 'insert' },
							{
								operationType: 'update',
								$or: [
									{ 'updateDescription.updatedFields.status': { $exists: true } },
									{ 'updateDescription.updatedFields.nextRunAt': { $exists: true } },
								],
							},
						],
					},
				},
			];

			this.changeStream = this.ctx.collection.watch(pipeline, {
				fullDocument: 'updateLookup',
			});

			// Handle change events
			this.changeStream.on('change', (change) => {
				this.handleEvent(change);
			});

			// Handle errors with reconnection
			this.changeStream.on('error', (error: Error) => {
				this.ctx.emit('changestream:error', { error });
				this.handleError(error);
			});

			// Mark as connected
			this.usingChangeStreams = true;
			this.reconnectAttempts = 0;
			this.ctx.emit('changestream:connected', undefined);
		} catch (error) {
			// Change streams not available (e.g., standalone MongoDB)
			this.usingChangeStreams = false;
			const reason = error instanceof Error ? error.message : 'Unknown error';
			this.ctx.emit('changestream:fallback', { reason });
		}
	}

	/**
	 * Handle a change stream event using the full document for intelligent routing.
	 *
	 * For **immediate jobs** (`nextRunAt <= now`): collects the job name and triggers
	 * a debounced targeted poll for only the relevant workers.
	 *
	 * For **future jobs** (`nextRunAt > now`): schedules a precise wakeup timer so
	 * the job is picked up near its scheduled time without blind polling.
	 *
	 * For **completed/failed jobs** (slot freed): triggers a targeted re-poll for that
	 * worker so the next pending job is picked up immediately, maintaining continuous
	 * throughput without waiting for the safety poll interval.
	 *
	 * Falls back to a full poll (no target names) if the document is missing
	 * required fields.
	 *
	 * @param change - The change stream event document
	 */
	handleEvent(change: ChangeStreamDocument<Document>): void {
		if (!this.ctx.isRunning()) {
			return;
		}

		// Trigger poll on insert (new job) or update where status changes
		const isInsert = change.operationType === 'insert';
		const isUpdate = change.operationType === 'update';

		// Get fullDocument if available (for insert or with updateLookup option)
		const fullDocument = 'fullDocument' in change ? change.fullDocument : undefined;
		const currentStatus = fullDocument?.['status'] as string | undefined;
		const isPendingStatus = currentStatus === JobStatus.PENDING;

		// A completed/failed status change means a concurrency slot was freed.
		// Trigger a re-poll so the next pending job is picked up immediately,
		// rather than waiting for the safety poll interval.
		const isSlotFreed =
			isUpdate && (currentStatus === JobStatus.COMPLETED || currentStatus === JobStatus.FAILED);

		// For inserts: always trigger since new pending jobs need processing
		// For updates to pending: trigger (retry/release/recurring reschedule)
		// For updates to completed/failed: trigger (concurrency slot freed)
		const shouldTrigger = isInsert || (isUpdate && isPendingStatus) || isSlotFreed;

		if (!shouldTrigger) {
			return;
		}

		// Slot-freed events: targeted poll for that worker to pick up waiting jobs
		if (isSlotFreed) {
			const jobName = fullDocument?.['name'] as string | undefined;
			if (jobName) {
				this.pendingTargetNames.add(jobName);
			}
			this.debouncedPoll();
			return;
		}

		// Extract job metadata from the full document for smart routing
		const jobName = fullDocument?.['name'] as string | undefined;
		const nextRunAt = fullDocument?.['nextRunAt'] as Date | undefined;

		if (jobName && nextRunAt) {
			this.notifyPendingJob(jobName, nextRunAt);
			return;
		}

		// Immediate job or missing metadata — collect for targeted/full poll
		if (jobName) {
			this.pendingTargetNames.add(jobName);
		}
		this.debouncedPoll();
	}

	/**
	 * Notify the handler about a pending job created or updated by this process.
	 *
	 * Reuses the same routing logic as change stream events so local writes don't
	 * depend on the MongoDB change stream cursor already being fully ready.
	 *
	 * @param jobName - Worker name for targeted polling
	 * @param nextRunAt - When the job becomes eligible for processing
	 */
	notifyPendingJob(jobName: string, nextRunAt: Date): void {
		if (!this.ctx.isRunning()) {
			return;
		}

		if (nextRunAt.getTime() > Date.now()) {
			this.scheduleWakeup(nextRunAt);
			return;
		}

		this.pendingTargetNames.add(jobName);
		this.debouncedPoll();
	}

	/**
	 * Schedule a debounced poll with collected target names.
	 *
	 * Collects job names from multiple change stream events during the debounce
	 * window, then triggers a single targeted poll for only those workers.
	 */
	private debouncedPoll(): void {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
		}

		this.debounceTimer = setTimeout(() => {
			this.debounceTimer = null;
			const names = this.pendingTargetNames.size > 0 ? new Set(this.pendingTargetNames) : undefined;
			this.pendingTargetNames.clear();
			this.onPoll(names).catch((error: unknown) => {
				this.ctx.emit('job:error', { error: toError(error) });
			});
		}, 100);
	}

	/**
	 * Schedule a wakeup timer for a future-dated job.
	 *
	 * Maintains a single timer set to the earliest known future job's `nextRunAt`.
	 * When the timer fires, triggers a full poll to pick up all due jobs.
	 *
	 * @param nextRunAt - When the future job should become ready
	 */
	private scheduleWakeup(nextRunAt: Date): void {
		// Only update if this job is earlier than the current wakeup
		if (this.wakeupTime && nextRunAt >= this.wakeupTime) {
			return;
		}

		this.clearWakeupTimer();
		this.wakeupTime = nextRunAt;

		const delay = Math.max(nextRunAt.getTime() - Date.now() + POLL_GRACE_PERIOD, MIN_POLL_INTERVAL);

		this.wakeupTimer = setTimeout(() => {
			this.wakeupTime = null;
			this.wakeupTimer = null;
			// Full poll — there may be multiple jobs due at this time
			this.onPoll().catch((error: unknown) => {
				this.ctx.emit('job:error', { error: toError(error) });
			});
		}, delay);
	}

	/**
	 * Handle change stream errors with exponential backoff reconnection.
	 *
	 * Attempts to reconnect up to `maxReconnectAttempts` times with
	 * exponential backoff (base 1000ms). After exhausting retries, falls back to
	 * polling-only mode.
	 *
	 * @param error - The error that caused the change stream failure
	 */
	handleError(error: Error): void {
		if (!this.ctx.isRunning()) {
			return;
		}

		this.reconnectAttempts++;

		// Immediately reset active state: clears stale debounce/wakeup timers,
		// closes the broken cursor, and sets isActive() to false so the lifecycle
		// manager switches to fast polling during backoff.
		this.resetActiveState();
		this.closeChangeStream();

		if (this.reconnectAttempts > this.maxReconnectAttempts) {
			// Permanent fallback to polling-only mode
			this.clearReconnectTimer();

			this.ctx.emit('changestream:fallback', {
				reason: `Exhausted ${this.maxReconnectAttempts} reconnection attempts: ${error.message}`,
			});

			return;
		}

		// Exponential backoff: 1s, 2s, 4s
		const delay = 2 ** (this.reconnectAttempts - 1) * 1000;

		// Clear any existing reconnect timer before scheduling a new one
		this.clearReconnectTimer();

		if (!this.ctx.isRunning()) {
			return;
		}

		this.reconnectTimer = setTimeout(() => {
			this.clearReconnectTimer();
			this.reconnect();
		}, delay);
	}

	private reconnect(): void {
		if (!this.ctx.isRunning()) {
			return;
		}

		this.closeChangeStream();

		if (!this.ctx.isRunning()) {
			return;
		}

		this.setup();
	}

	private clearReconnectTimer(): void {
		if (!this.reconnectTimer) {
			return;
		}

		clearTimeout(this.reconnectTimer);
		this.reconnectTimer = null;
	}

	/**
	 * Reset all active change stream state: clear debounce timer, wakeup timer,
	 * pending target names, and mark as inactive.
	 *
	 * Does NOT close the cursor (callers handle sync vs async close) or clear
	 * the reconnect timer/attempts (callers manage reconnection lifecycle).
	 */
	private resetActiveState(): void {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}

		this.pendingTargetNames.clear();
		this.clearWakeupTimer();
		this.usingChangeStreams = false;
	}

	private clearWakeupTimer(): void {
		if (this.wakeupTimer) {
			clearTimeout(this.wakeupTimer);
			this.wakeupTimer = null;
		}
		this.wakeupTime = null;
	}

	private closeChangeStream(): void {
		if (!this.changeStream) {
			return;
		}

		this.changeStream.close().catch(() => {});
		this.changeStream = null;
	}

	/**
	 * Close the change stream cursor and emit closed event.
	 */
	async close(): Promise<void> {
		const wasActive = this.usingChangeStreams;

		// Clear all active state (debounce, wakeup, pending names, flag)
		this.resetActiveState();
		this.clearReconnectTimer();

		if (this.changeStream) {
			try {
				await this.changeStream.close();
			} catch {
				// Ignore close errors during shutdown
			}
			this.changeStream = null;

			if (wasActive) {
				this.ctx.emit('changestream:closed', undefined);
			}
		}

		this.reconnectAttempts = 0;
	}

	/**
	 * Check if change streams are currently active.
	 */
	isActive(): boolean {
		return this.usingChangeStreams;
	}
}
