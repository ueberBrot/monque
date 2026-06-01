import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockContext, JobFactory, JobFactoryHelpers } from '@tests/factories';
import { JobStatus } from '@/jobs';
import { JobLifecycle } from '@/scheduler/services/job-lifecycle.js';
import { ConnectionError } from '@/shared';

describe('JobLifecycle', () => {
	let ctx: ReturnType<typeof createMockContext>;
	let lifecycle: JobLifecycle;

	beforeEach(() => {
		ctx = createMockContext();
		lifecycle = new JobLifecycle(ctx);
	});

	describe('claimNext', () => {
		it('claims the earliest due pending job for this scheduler instance', async () => {
			const pendingJob = JobFactory.build({ name: 'email' });
			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(pendingJob);

			const job = await lifecycle.claimNext('email');

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
		});
	});

	describe('completeOwned', () => {
		it('returns null and skips notification when recurring completion loses ownership', async () => {
			const job = JobFactoryHelpers.processing({
				repeatInterval: '0 * * * *',
			});

			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(null);

			const result = await lifecycle.completeOwned(job);

			expect(result).toBeNull();
			expect(ctx.notifyPendingJob).not.toHaveBeenCalled();
		});
	});

	describe('recoverStaleJobs', () => {
		it('resets stale processing jobs to pending and emits the recovered count', async () => {
			vi.spyOn(ctx.mockCollection, 'updateMany').mockResolvedValueOnce({
				acknowledged: true,
				matchedCount: 2,
				modifiedCount: 2,
				upsertedCount: 0,
				upsertedId: null,
			});

			await lifecycle.recoverStaleJobs();

			expect(ctx.mockCollection.updateMany).toHaveBeenCalledWith(
				{
					status: JobStatus.PROCESSING,
					lockedAt: { $lt: expect.any(Date) },
				},
				{
					$set: {
						status: JobStatus.PENDING,
						updatedAt: expect.any(Date),
					},
					$unset: {
						lockedAt: '',
						claimedBy: '',
						lastHeartbeat: '',
					},
				},
			);
			expect(ctx.emitHistory).toContainEqual({
				event: 'stale:recovered',
				payload: { count: 2 },
			});
		});
	});

	describe('assertNoActiveInstanceCollision', () => {
		it('throws when another processing job has this scheduler id and a recent heartbeat', async () => {
			const activeJob = JobFactory.build({
				name: 'email',
				status: JobStatus.PROCESSING,
				claimedBy: 'test-instance-id',
				lastHeartbeat: new Date(),
			});
			vi.spyOn(ctx.mockCollection, 'findOne').mockResolvedValueOnce(activeJob);

			await expect(lifecycle.assertNoActiveInstanceCollision()).rejects.toThrow(ConnectionError);
			expect(ctx.mockCollection.findOne).toHaveBeenCalledWith({
				claimedBy: 'test-instance-id',
				status: JobStatus.PROCESSING,
				lastHeartbeat: { $gte: expect.any(Date) },
			});
		});
	});
});
