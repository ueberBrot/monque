import { toError } from '@/shared';

import type { SchedulerContext } from './types.js';

/** Minimum poll interval floor to prevent tight loops (ms) */
const MIN_POLL_INTERVAL = 100;

/** Grace period after nextRunAt before scheduling a wakeup poll (ms) */
const POLL_GRACE_PERIOD = 200;

/**
 * Routes Pending Notifications into targeted polls or future wakeups.
 *
 * This module owns the local routing rules shared by MongoDB change streams and
 * local writes. The change stream adapter only decides when a Job became relevant.
 */
export class PendingNotificationRouter {
	/** Debounce timer for immediate Pending Notifications */
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;

	/** Job names collected during the current debounce window for targeted polling */
	private pendingTargetNames: Set<string> = new Set();

	/** Wakeup timer for the earliest known future Job */
	private wakeupTimer: ReturnType<typeof setTimeout> | null = null;

	/** Time of the currently scheduled wakeup */
	private wakeupTime: Date | null = null;

	constructor(
		private readonly ctx: SchedulerContext,
		private readonly onPoll: (targetNames?: ReadonlySet<string>) => Promise<void>,
	) {}

	notifyPendingJob(jobName: string | undefined, nextRunAt: Date): void {
		if (!this.ctx.isRunning()) {
			return;
		}

		if (nextRunAt.getTime() > Date.now()) {
			this.scheduleWakeup(nextRunAt);
			return;
		}

		this.notifyRunnableJob(jobName);
	}

	notifyRunnableJob(jobName?: string): void {
		if (!this.ctx.isRunning()) {
			return;
		}

		if (jobName) {
			this.pendingTargetNames.add(jobName);
		}

		this.debouncedPoll();
	}

	close(): void {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}

		this.pendingTargetNames.clear();
		this.clearWakeupTimer();
	}

	/**
	 * Schedule a debounced poll with collected target names.
	 *
	 * Collects Job Names from multiple Pending Notifications during the debounce
	 * window, then triggers a single targeted poll for only those Workers.
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
	 * Schedule a wakeup timer for a future-dated Job.
	 *
	 * Maintains a single timer set to the earliest known future Job's `nextRunAt`.
	 * When the timer fires, triggers a full poll to pick up all due Jobs.
	 */
	private scheduleWakeup(nextRunAt: Date): void {
		if (this.wakeupTime && nextRunAt >= this.wakeupTime) {
			return;
		}

		this.clearWakeupTimer();
		this.wakeupTime = nextRunAt;

		const delay = Math.max(nextRunAt.getTime() - Date.now() + POLL_GRACE_PERIOD, MIN_POLL_INTERVAL);

		this.wakeupTimer = setTimeout(() => {
			this.wakeupTime = null;
			this.wakeupTimer = null;
			this.onPoll().catch((error: unknown) => {
				this.ctx.emit('job:error', { error: toError(error) });
			});
		}, delay);
	}

	private clearWakeupTimer(): void {
		if (this.wakeupTimer) {
			clearTimeout(this.wakeupTimer);
			this.wakeupTimer = null;
		}
		this.wakeupTime = null;
	}
}
