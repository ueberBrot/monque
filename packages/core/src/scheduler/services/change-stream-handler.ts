import type { ChangeStream, ChangeStreamDocument, Document } from 'mongodb';

import { JobStatus } from '@/jobs';

import type { SchedulerContext } from './types.js';

/**
 * Internal service for MongoDB Change Stream lifecycle.
 *
 * Provides real-time job notifications when available, with automatic
 * reconnection and graceful fallback to polling-only mode.
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

	constructor(
		private readonly ctx: SchedulerContext,
		private readonly onPoll: () => Promise<void>,
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

		try {
			// Create change stream with pipeline to filter relevant events
			const pipeline = [
				{
					$match: {
						$or: [
							{ operationType: 'insert' },
							{
								operationType: 'update',
								'updateDescription.updatedFields.status': { $exists: true },
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
	 * Handle a change stream event by triggering a debounced poll.
	 *
	 * Events are debounced to prevent "claim storms" when multiple changes arrive
	 * in rapid succession (e.g., bulk job inserts). A 100ms debounce window
	 * collects multiple events and triggers a single poll.
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
		const isPendingStatus = fullDocument?.['status'] === JobStatus.PENDING;

		// For inserts: always trigger since new pending jobs need processing
		// For updates: trigger if status changed to pending (retry/release scenario)
		const shouldTrigger = isInsert || (isUpdate && isPendingStatus);

		if (shouldTrigger) {
			// Debounce poll triggers to avoid claim storms
			if (this.debounceTimer) {
				clearTimeout(this.debounceTimer);
			}

			this.debounceTimer = setTimeout(() => {
				this.debounceTimer = null;
				this.onPoll().catch((error: unknown) => {
					this.ctx.emit('job:error', { error: error as Error });
				});
			}, 100);
		}
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

		if (this.reconnectAttempts > this.maxReconnectAttempts) {
			// Fall back to polling-only mode
			this.usingChangeStreams = false;

			if (this.reconnectTimer) {
				clearTimeout(this.reconnectTimer);
				this.reconnectTimer = null;
			}

			if (this.changeStream) {
				this.changeStream.close().catch(() => {});
				this.changeStream = null;
			}

			this.ctx.emit('changestream:fallback', {
				reason: `Exhausted ${this.maxReconnectAttempts} reconnection attempts: ${error.message}`,
			});

			return;
		}

		// Exponential backoff: 1s, 2s, 4s
		const delay = 2 ** (this.reconnectAttempts - 1) * 1000;

		// Clear any existing reconnect timer before scheduling a new one
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
		}

		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			if (this.ctx.isRunning()) {
				// Close existing change stream before reconnecting
				if (this.changeStream) {
					this.changeStream.close().catch(() => {});
					this.changeStream = null;
				}
				this.setup();
			}
		}, delay);
	}

	/**
	 * Close the change stream cursor and emit closed event.
	 */
	async close(): Promise<void> {
		// Clear debounce timer
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}

		// Clear reconnection timer
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}

		if (this.changeStream) {
			try {
				await this.changeStream.close();
			} catch {
				// Ignore close errors during shutdown
			}
			this.changeStream = null;

			if (this.usingChangeStreams) {
				this.ctx.emit('changestream:closed', undefined);
			}
		}

		this.usingChangeStreams = false;
		this.reconnectAttempts = 0;
	}

	/**
	 * Check if change streams are currently active.
	 */
	isActive(): boolean {
		return this.usingChangeStreams;
	}
}
