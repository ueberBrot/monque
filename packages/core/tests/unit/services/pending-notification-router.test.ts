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
});
