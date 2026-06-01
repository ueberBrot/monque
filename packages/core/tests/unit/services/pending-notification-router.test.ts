import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockContext } from '@tests/factories';
import { PendingNotificationRouter } from '@/scheduler/services/pending-notification-router.js';

describe('PendingNotificationRouter', () => {
	let ctx: ReturnType<typeof createMockContext>;
	let onPoll: (targetNames?: ReadonlySet<string>) => Promise<void>;
	let router: PendingNotificationRouter;

	beforeEach(() => {
		vi.useFakeTimers();
		ctx = createMockContext();
		onPoll = vi.fn().mockResolvedValue(undefined) as unknown as (
			targetNames?: ReadonlySet<string>,
		) => Promise<void>;
		router = new PendingNotificationRouter(ctx, onPoll);
	});

	afterEach(() => {
		router.close();
		vi.clearAllMocks();
		vi.useRealTimers();
	});

	it('routes immediate Job Names together and wakes once for the earliest future Job', () => {
		router.notifyPendingJob('email', new Date(Date.now() - 1000));
		router.notifyPendingJob('sms', new Date(Date.now() - 1000));
		router.notifyPendingJob('late', new Date(Date.now() + 10_000));
		router.notifyPendingJob('early', new Date(Date.now() + 3000));

		vi.advanceTimersByTime(150);

		expect(onPoll).toHaveBeenCalledOnce();
		expect(onPoll).toHaveBeenCalledWith(new Set(['email', 'sms']));

		vi.advanceTimersByTime(3050);

		expect(onPoll).toHaveBeenCalledTimes(2);
		expect(onPoll).toHaveBeenLastCalledWith();
	});

	it('deduplicates repeated immediate notifications for the same Job Name', () => {
		const nextRunAt = new Date(Date.now() - 1000);

		router.notifyPendingJob('email', nextRunAt);
		router.notifyPendingJob('email', nextRunAt);

		vi.advanceTimersByTime(150);

		expect(onPoll).toHaveBeenCalledOnce();
		expect(onPoll).toHaveBeenCalledWith(new Set(['email']));
	});

	it('does not route pending notifications when the scheduler is stopped', () => {
		vi.mocked(ctx.isRunning).mockReturnValue(false);

		router.notifyPendingJob('email', new Date(Date.now() - 1000));

		vi.advanceTimersByTime(150);

		expect(onPoll).not.toHaveBeenCalled();
	});

	it('does not route runnable notifications when the scheduler is stopped', () => {
		vi.mocked(ctx.isRunning).mockReturnValue(false);

		router.notifyRunnableJob('email');

		vi.advanceTimersByTime(150);

		expect(onPoll).not.toHaveBeenCalled();
	});

	it('routes runnable notifications without a Job Name as a full poll', () => {
		router.notifyRunnableJob();

		vi.advanceTimersByTime(150);

		expect(onPoll).toHaveBeenCalledOnce();
		expect(onPoll).toHaveBeenCalledWith(undefined);
	});

	it('routes immediate pending notifications without a Job Name as a full poll', () => {
		router.notifyPendingJob(undefined, new Date(Date.now() - 1000));

		vi.advanceTimersByTime(150);

		expect(onPoll).toHaveBeenCalledOnce();
		expect(onPoll).toHaveBeenCalledWith(undefined);
	});

	it('allows close to be called repeatedly without polling', () => {
		router.notifyPendingJob('email', new Date(Date.now() - 1000));
		router.notifyPendingJob('late', new Date(Date.now() + 1000));

		expect(() => {
			router.close();
			router.close();
			router.close();
		}).not.toThrow();

		vi.advanceTimersByTime(1500);

		expect(onPoll).not.toHaveBeenCalled();
	});

	it('emits job:error when polling rejects and continues routing later notifications', async () => {
		const pollError = new Error('Poll failed');
		onPoll = vi
			.fn()
			.mockRejectedValueOnce(pollError)
			.mockResolvedValueOnce(undefined) as unknown as (
			targetNames?: ReadonlySet<string>,
		) => Promise<void>;
		router.close();
		router = new PendingNotificationRouter(ctx, onPoll);

		router.notifyPendingJob('email', new Date(Date.now() - 1000));
		await vi.advanceTimersByTimeAsync(150);

		expect(ctx.emitHistory).toContainEqual({
			event: 'job:error',
			payload: { error: pollError },
		});

		router.notifyPendingJob('sms', new Date(Date.now() - 1000));
		await vi.advanceTimersByTimeAsync(150);

		expect(onPoll).toHaveBeenCalledTimes(2);
		expect(onPoll).toHaveBeenLastCalledWith(new Set(['sms']));
	});

	it('keeps the earliest future wakeup when a later pending Job is notified', () => {
		router.notifyPendingJob('early', new Date(Date.now() + 1000));
		router.notifyPendingJob('late', new Date(Date.now() + 10_000));

		vi.advanceTimersByTime(1250);

		expect(onPoll).toHaveBeenCalledOnce();
		expect(onPoll).toHaveBeenCalledWith();
	});

	it('emits job:error when a future wakeup poll rejects', async () => {
		const pollError = new Error('Wakeup poll failed');
		onPoll = vi.fn().mockRejectedValueOnce(pollError) as unknown as (
			targetNames?: ReadonlySet<string>,
		) => Promise<void>;
		router.close();
		router = new PendingNotificationRouter(ctx, onPoll);

		router.notifyPendingJob('email', new Date(Date.now() + 1000));
		await vi.advanceTimersByTimeAsync(1250);

		expect(ctx.emitHistory).toContainEqual({
			event: 'job:error',
			payload: { error: pollError },
		});
	});
});
