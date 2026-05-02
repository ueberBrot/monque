import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockContext, JobFactory } from '@tests/factories';
import { JobStatus } from '@/jobs';
import { JobSelection } from '@/scheduler/services';
import { ConnectionError } from '@/shared';

describe('JobSelection', () => {
	let ctx: ReturnType<typeof createMockContext>;
	let selection: JobSelection;

	beforeEach(() => {
		ctx = createMockContext();
		selection = new JobSelection(ctx);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('atomically claims the earliest due pending job for this instance', async () => {
		const pendingJob = JobFactory.build({ name: 'email' });
		vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(pendingJob);

		const job = await selection.acquireNext('email');

		expect(job?.name).toBe('email');
		expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				name: 'email',
				status: JobStatus.PENDING,
				nextRunAt: { $lte: expect.any(Date) },
			}),
			expect.objectContaining({
				$set: expect.objectContaining({
					status: JobStatus.PROCESSING,
					claimedBy: 'test-instance-id',
					lockedAt: expect.any(Date),
					lastHeartbeat: expect.any(Date),
					heartbeatInterval: ctx.options.heartbeatInterval,
				}),
			}),
			{
				sort: { nextRunAt: 1 },
				returnDocument: 'after',
			},
		);
		expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalledWith(
			expect.objectContaining({ $or: expect.any(Array) }),
			expect.any(Object),
			expect.any(Object),
		);
	});

	it('does not claim jobs when the scheduler is stopping', async () => {
		vi.spyOn(ctx, 'isRunning').mockReturnValue(false);

		const job = await selection.acquireNext('email');

		expect(job).toBeNull();
		expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
	});

	it('returns null when no due pending job can be claimed', async () => {
		vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(null);

		const job = await selection.acquireNext('email');

		expect(job).toBeNull();
	});

	it('is idempotent under concurrent claims', async () => {
		const pendingJob = JobFactory.build({ name: 'email' });
		vi.spyOn(ctx.mockCollection, 'findOneAndUpdate')
			.mockResolvedValueOnce(pendingJob)
			.mockResolvedValueOnce(null);

		const results = await Promise.all([
			selection.acquireNext('email'),
			selection.acquireNext('email'),
		]);
		const claimedJobs = results.filter((job) => job !== null);

		expect(claimedJobs).toHaveLength(1);
		expect(claimedJobs[0]?.name).toBe('email');
		expect(results).toContain(null);
		expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalledTimes(2);
	});

	it('wraps selection failures with job context', async () => {
		vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockRejectedValueOnce('database offline');

		const result = selection.acquireNext('email');

		await expect(result).rejects.toThrow(
			'Failed to acquire next job for "email": database offline',
		);
		await expect(result).rejects.toThrow(ConnectionError);
	});
});
