/**
 * Unit tests for LifecycleManager service.
 *
 * Tests timer setup/teardown, cleanup logic, and error emission.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockContext } from '@tests/factories';
import { JobStatus } from '@/jobs';
import { LifecycleManager } from '@/scheduler/services/lifecycle-manager.js';

describe('LifecycleManager', () => {
	let ctx: ReturnType<typeof createMockContext>;
	let manager: LifecycleManager;
	let pollFn: ReturnType<typeof vi.fn>;
	let heartbeatFn: ReturnType<typeof vi.fn>;
	let isChangeStreamActiveFn: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.useFakeTimers();
		ctx = createMockContext();
		manager = new LifecycleManager(ctx);
		pollFn = vi.fn().mockResolvedValue(undefined);
		heartbeatFn = vi.fn().mockResolvedValue(undefined);
		isChangeStreamActiveFn = vi.fn().mockReturnValue(false);
	});

	afterEach(() => {
		manager.stopTimers();
		vi.clearAllMocks();
		vi.useRealTimers();
	});

	/** Helper to build typed timer callbacks from the mock fns. */
	const callbacks = (): Parameters<typeof manager.startTimers>[0] => ({
		poll: pollFn as unknown as () => Promise<void>,
		updateHeartbeats: heartbeatFn as unknown as () => Promise<void>,
		isChangeStreamActive: isChangeStreamActiveFn as unknown as () => boolean,
	});

	describe('startTimers', () => {
		it('should run initial poll immediately', () => {
			manager.startTimers(callbacks());

			// Poll called once immediately (the initial poll)
			expect(pollFn).toHaveBeenCalledOnce();
		});

		it('should set up poll interval', async () => {
			manager.startTimers(callbacks());

			// Clear the initial poll call
			pollFn.mockClear();

			// Advance by one poll interval (default 1000ms)
			await vi.advanceTimersByTimeAsync(ctx.options.pollInterval);

			expect(pollFn).toHaveBeenCalledOnce();
		});

		it('should set up heartbeat interval', async () => {
			manager.startTimers(callbacks());

			// Advance by one heartbeat interval
			await vi.advanceTimersByTimeAsync(ctx.options.heartbeatInterval);

			expect(heartbeatFn).toHaveBeenCalledOnce();
		});

		it('should set up cleanup interval when jobRetention is configured', async () => {
			ctx.options.jobRetention = { completed: 60000, failed: 120000 };
			manager = new LifecycleManager(ctx);

			vi.spyOn(ctx.collection, 'deleteMany').mockResolvedValue({
				acknowledged: true,
				deletedCount: 0,
			});

			manager.startTimers(callbacks());

			// cleanupJobs should run immediately on start
			expect(ctx.collection.deleteMany).toHaveBeenCalled();
		});

		it('should run cleanup on interval when jobRetention is configured', async () => {
			const retentionInterval = 5000;
			ctx.options.jobRetention = {
				completed: 60000,
				failed: 120000,
				interval: retentionInterval,
			};
			manager = new LifecycleManager(ctx);

			vi.spyOn(ctx.collection, 'deleteMany').mockResolvedValue({
				acknowledged: true,
				deletedCount: 0,
			});

			manager.startTimers(callbacks());

			// Clear the immediate call
			vi.mocked(ctx.collection.deleteMany).mockClear();

			// Advance by the retention interval
			await vi.advanceTimersByTimeAsync(retentionInterval);

			expect(ctx.collection.deleteMany).toHaveBeenCalled();
		});

		it('should skip cleanup when no jobRetention is configured', async () => {
			// Default ctx has no jobRetention — spy must be in place before
			// startTimers so any immediate cleanup call would be observed.
			vi.spyOn(ctx.collection, 'deleteMany');

			manager.startTimers(callbacks());

			await vi.advanceTimersByTimeAsync(10000);

			// With no jobRetention, cleanupJobs is never called
			expect(ctx.collection.deleteMany).not.toHaveBeenCalled();
		});

		it('should emit job:error when poll callback rejects', async () => {
			const pollError = new Error('Poll failed');
			const failingPoll = vi.fn().mockRejectedValue(pollError) as unknown as () => Promise<void>;

			manager.startTimers({
				poll: failingPoll,
				updateHeartbeats: heartbeatFn as unknown as () => Promise<void>,
				isChangeStreamActive: isChangeStreamActiveFn as unknown as () => boolean,
			});

			// Wait for the initial poll rejection to be handled
			await vi.advanceTimersByTimeAsync(0);

			expect(ctx.emitHistory).toContainEqual(
				expect.objectContaining({
					event: 'job:error',
					payload: expect.objectContaining({ error: pollError }),
				}),
			);
		});

		it('should emit job:error when heartbeat callback rejects', async () => {
			const heartbeatError = new Error('Heartbeat failed');
			const failingHeartbeat = vi
				.fn()
				.mockRejectedValue(heartbeatError) as unknown as () => Promise<void>;

			manager.startTimers({
				poll: pollFn as unknown as () => Promise<void>,
				updateHeartbeats: failingHeartbeat,
				isChangeStreamActive: isChangeStreamActiveFn as unknown as () => boolean,
			});

			// Advance past one heartbeat interval
			await vi.advanceTimersByTimeAsync(ctx.options.heartbeatInterval);

			expect(ctx.emitHistory).toContainEqual(
				expect.objectContaining({
					event: 'job:error',
					payload: expect.objectContaining({ error: heartbeatError }),
				}),
			);
		});

		it('should emit job:error when interval poll callback rejects', async () => {
			const pollError = new Error('Interval poll failed');
			// First call succeeds (initial poll), subsequent calls fail
			const failingPoll = vi
				.fn()
				.mockResolvedValueOnce(undefined)
				.mockRejectedValue(pollError) as unknown as () => Promise<void>;

			manager.startTimers({
				poll: failingPoll,
				updateHeartbeats: heartbeatFn as unknown as () => Promise<void>,
				isChangeStreamActive: isChangeStreamActiveFn as unknown as () => boolean,
			});

			// Advance past one poll interval
			await vi.advanceTimersByTimeAsync(ctx.options.pollInterval);

			expect(ctx.emitHistory).toContainEqual(
				expect.objectContaining({
					event: 'job:error',
					payload: expect.objectContaining({ error: pollError }),
				}),
			);
		});

		it('should emit job:error when initial cleanupJobs rejects', async () => {
			ctx.options.jobRetention = { completed: 60000, failed: 120000 };
			manager = new LifecycleManager(ctx);

			const cleanupError = new Error('Cleanup failed');
			vi.spyOn(ctx.collection, 'deleteMany').mockRejectedValue(cleanupError);

			manager.startTimers(callbacks());

			// Wait for the initial cleanupJobs rejection to be handled
			await vi.advanceTimersByTimeAsync(0);

			expect(ctx.emitHistory).toContainEqual(
				expect.objectContaining({
					event: 'job:error',
					payload: expect.objectContaining({ error: cleanupError }),
				}),
			);
		});

		it('should emit job:error when interval cleanupJobs rejects', async () => {
			const retentionInterval = 5000;
			ctx.options.jobRetention = {
				completed: 60000,
				failed: 120000,
				interval: retentionInterval,
			};
			manager = new LifecycleManager(ctx);

			const cleanupError = new Error('Cleanup failed');
			vi.spyOn(ctx.collection, 'deleteMany')
				.mockResolvedValueOnce({ acknowledged: true, deletedCount: 0 })
				.mockRejectedValueOnce(cleanupError);

			manager.startTimers(callbacks());

			// Advance by the retention interval to trigger the failing cleanup
			await vi.advanceTimersByTimeAsync(retentionInterval);

			expect(ctx.emitHistory).toContainEqual(
				expect.objectContaining({
					event: 'job:error',
					payload: expect.objectContaining({ error: cleanupError }),
				}),
			);
		});
	});

	describe('stopTimers', () => {
		it('should clear all intervals so callbacks stop firing', async () => {
			manager.startTimers(callbacks());

			// Clear initial call counts
			pollFn.mockClear();
			heartbeatFn.mockClear();

			manager.stopTimers();

			// Advance time — no callbacks should fire
			await vi.advanceTimersByTimeAsync(ctx.options.pollInterval * 5);
			await vi.advanceTimersByTimeAsync(ctx.options.heartbeatInterval * 5);

			expect(pollFn).not.toHaveBeenCalled();
			expect(heartbeatFn).not.toHaveBeenCalled();
		});

		it('should be safe to call multiple times', () => {
			manager.startTimers(callbacks());

			expect(() => {
				manager.stopTimers();
				manager.stopTimers();
			}).not.toThrow();
		});
	});

	describe('adaptive poll scheduling', () => {
		it('should use safetyPollInterval when change streams are active', async () => {
			isChangeStreamActiveFn.mockReturnValue(true);
			manager.startTimers(callbacks());

			// Clear initial poll call
			pollFn.mockClear();

			// Should NOT fire at pollInterval (1000ms)
			await vi.advanceTimersByTimeAsync(ctx.options.pollInterval);
			expect(pollFn).not.toHaveBeenCalled();

			// Should fire at safetyPollInterval (30000ms)
			await vi.advanceTimersByTimeAsync(ctx.options.safetyPollInterval - ctx.options.pollInterval);
			expect(pollFn).toHaveBeenCalledOnce();
		});

		it('should use pollInterval when change streams are not active', async () => {
			isChangeStreamActiveFn.mockReturnValue(false);
			manager.startTimers(callbacks());

			// Clear initial poll call
			pollFn.mockClear();

			// Should fire at pollInterval (1000ms)
			await vi.advanceTimersByTimeAsync(ctx.options.pollInterval);
			expect(pollFn).toHaveBeenCalledOnce();
		});

		it('should switch intervals when change stream status changes', async () => {
			// Start with CS active (uses safetyPollInterval)
			isChangeStreamActiveFn.mockReturnValue(true);
			manager.startTimers(callbacks());
			pollFn.mockClear();

			// Switch to CS inactive and force re-evaluation
			isChangeStreamActiveFn.mockReturnValue(false);
			manager.resetPollTimer();

			// Next poll should happen at pollInterval (not safetyPollInterval)
			await vi.advanceTimersByTimeAsync(ctx.options.pollInterval);
			expect(pollFn).toHaveBeenCalledOnce();
		});

		it('should continue scheduling after poll errors', async () => {
			const pollError = new Error('Poll failed');
			const failingPoll = vi
				.fn()
				.mockRejectedValueOnce(pollError)
				.mockResolvedValue(undefined) as unknown as () => Promise<void>;

			manager.startTimers({
				poll: failingPoll,
				updateHeartbeats: heartbeatFn as unknown as () => Promise<void>,
				isChangeStreamActive: isChangeStreamActiveFn as unknown as () => boolean,
			});

			// Wait for initial poll error to be handled
			await vi.advanceTimersByTimeAsync(0);

			// Next poll should still be scheduled at pollInterval
			await vi.advanceTimersByTimeAsync(ctx.options.pollInterval);
			expect(failingPoll).toHaveBeenCalledTimes(2);
		});
	});

	describe('resetPollTimer', () => {
		it('should cancel current timer and reschedule', async () => {
			manager.startTimers(callbacks());
			pollFn.mockClear();

			// Advance halfway through the poll interval
			await vi.advanceTimersByTimeAsync(ctx.options.pollInterval / 2);
			expect(pollFn).not.toHaveBeenCalled();

			// Reset the timer — this restarts the countdown
			manager.resetPollTimer();

			// Advancing the remaining half should NOT trigger a poll
			// (timer was reset, so it needs the full interval from now)
			await vi.advanceTimersByTimeAsync(ctx.options.pollInterval / 2);
			expect(pollFn).not.toHaveBeenCalled();

			// But after the full interval from the reset, it should fire
			await vi.advanceTimersByTimeAsync(ctx.options.pollInterval / 2);
			expect(pollFn).toHaveBeenCalledOnce();
		});

		it('should use safetyPollInterval after reset when CS is active', async () => {
			isChangeStreamActiveFn.mockReturnValue(true);
			manager.startTimers(callbacks());
			pollFn.mockClear();

			// Reset the timer
			manager.resetPollTimer();

			// Should not fire at pollInterval
			await vi.advanceTimersByTimeAsync(ctx.options.pollInterval);
			expect(pollFn).not.toHaveBeenCalled();

			// Should fire at safetyPollInterval
			await vi.advanceTimersByTimeAsync(ctx.options.safetyPollInterval - ctx.options.pollInterval);
			expect(pollFn).toHaveBeenCalledOnce();
		});
	});

	describe('cleanupJobs', () => {
		it('should delete completed jobs older than retention', async () => {
			ctx.options.jobRetention = { completed: 60000 };
			manager = new LifecycleManager(ctx);

			vi.spyOn(ctx.collection, 'deleteMany').mockResolvedValue({
				acknowledged: true,
				deletedCount: 5,
			});

			await manager.cleanupJobs();

			expect(ctx.collection.deleteMany).toHaveBeenCalledWith(
				expect.objectContaining({
					status: JobStatus.COMPLETED,
					updatedAt: expect.objectContaining({ $lt: expect.any(Date) }),
				}),
			);
		});

		it('should delete failed jobs older than retention', async () => {
			ctx.options.jobRetention = { failed: 120000 };
			manager = new LifecycleManager(ctx);

			vi.spyOn(ctx.collection, 'deleteMany').mockResolvedValue({
				acknowledged: true,
				deletedCount: 3,
			});

			await manager.cleanupJobs();

			expect(ctx.collection.deleteMany).toHaveBeenCalledWith(
				expect.objectContaining({
					status: JobStatus.FAILED,
					updatedAt: expect.objectContaining({ $lt: expect.any(Date) }),
				}),
			);
		});

		it('should delete both completed and failed when both configured', async () => {
			ctx.options.jobRetention = { completed: 60000, failed: 120000 };
			manager = new LifecycleManager(ctx);

			vi.spyOn(ctx.collection, 'deleteMany').mockResolvedValue({
				acknowledged: true,
				deletedCount: 0,
			});

			await manager.cleanupJobs();

			expect(ctx.collection.deleteMany).toHaveBeenCalledTimes(2);
		});

		it('should be a no-op when jobRetention is not configured', async () => {
			// Default ctx has no jobRetention
			vi.spyOn(ctx.collection, 'deleteMany');

			await manager.cleanupJobs();

			expect(ctx.collection.deleteMany).not.toHaveBeenCalled();
		});
	});
});
