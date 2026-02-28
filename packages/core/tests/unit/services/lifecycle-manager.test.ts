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

	beforeEach(() => {
		vi.useFakeTimers();
		ctx = createMockContext();
		manager = new LifecycleManager(ctx);
		pollFn = vi.fn().mockResolvedValue(undefined);
		heartbeatFn = vi.fn().mockResolvedValue(undefined);
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
