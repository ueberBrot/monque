import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockContext, JobFactoryHelpers } from '@tests/factories';
import { JobStateTransitions } from '@/scheduler/services/job-state-transitions.js';

describe('JobStateTransitions', () => {
	let ctx: ReturnType<typeof createMockContext>;
	let transitions: JobStateTransitions;

	beforeEach(() => {
		ctx = createMockContext();
		transitions = new JobStateTransitions(ctx);
	});

	describe('completeOwned', () => {
		it('should return null and skip notification when recurring completion loses ownership', async () => {
			const job = JobFactoryHelpers.processing({
				repeatInterval: '0 * * * *',
			});

			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(null);

			const result = await transitions.completeOwned(job);

			expect(result).toBeNull();
			expect(ctx.notifyPendingJob).not.toHaveBeenCalled();
		});
	});

	describe('job id validation', () => {
		it('should return null without querying for invalid cancel ids', async () => {
			const result = await transitions.cancelPending('not-an-object-id');

			expect(result).toBeNull();
			expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
			expect(ctx.mockCollection.findOne).not.toHaveBeenCalled();
		});

		it('should return null without querying for invalid retry ids', async () => {
			const result = await transitions.retryTerminal('not-an-object-id');

			expect(result).toBeNull();
			expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
			expect(ctx.mockCollection.findOne).not.toHaveBeenCalled();
		});

		it('should return null without querying for invalid reschedule ids', async () => {
			const result = await transitions.reschedulePending('not-an-object-id', new Date());

			expect(result).toBeNull();
			expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
			expect(ctx.mockCollection.findOne).not.toHaveBeenCalled();
		});
	});
});
