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
	describe('claimNext', () => {
		it('should return null if scheduler is not running', async () => {
			vi.spyOn(ctx, 'isRunning').mockReturnValue(false);

			const job = await lifecycle.claimNext('test-job');

			expect(job).toBeNull();
			expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
		});

		it('should atomically claim a pending job', async () => {
			const pendingJob = JobFactory.build({ name: 'test-job' });
			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(pendingJob);

			const job = await lifecycle.claimNext('test-job');

			expect(job).not.toBeNull();
			expect(job?.name).toBe('test-job');
			expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
				expect.objectContaining({
					name: 'test-job',
					status: JobStatus.PENDING,
				}),
				expect.objectContaining({
					$set: expect.objectContaining({
						status: JobStatus.PROCESSING,
						claimedBy: 'test-instance-id',
					}),
				}),
				expect.any(Object),
			);
			expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalledWith(
				expect.objectContaining({ $or: expect.any(Array) }),
				expect.any(Object),
				expect.any(Object),
			);
		});

		it('should return null when no jobs available', async () => {
			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(null);

			const job = await lifecycle.claimNext('test-job');

			expect(job).toBeNull();
		});
	});

	describe('completeOwned', () => {
		it('should atomically mark one-time job as completed', async () => {
			const job = JobFactoryHelpers.processing();
			const completedJob = JobFactoryHelpers.completed({
				_id: job._id,
				name: job.name,
				data: job.data,
			});

			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(completedJob);

			const result = await lifecycle.completeOwned(job);

			expect(result).not.toBeNull();
			expect(result?.status).toBe(JobStatus.COMPLETED);
			expect(ctx.notifyPendingJob).not.toHaveBeenCalled();
			expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
				{ _id: job._id, status: JobStatus.PROCESSING, claimedBy: 'test-instance-id' },
				expect.objectContaining({
					$set: expect.objectContaining({ status: JobStatus.COMPLETED }),
				}),
				{ returnDocument: 'after' },
			);
		});

		it('should atomically reschedule recurring job with next cron date', async () => {
			const job = JobFactoryHelpers.processing({ repeatInterval: '0 * * * *' });
			const rescheduledJob = JobFactoryHelpers.pending({
				_id: job._id,
				name: job.name,
				data: job.data,
				repeatInterval: '0 * * * *',
				failCount: 0,
			});

			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(rescheduledJob);

			const result = await lifecycle.completeOwned(job);

			expect(result).not.toBeNull();
			expect(result?.status).toBe(JobStatus.PENDING);
			expect(ctx.notifyPendingJob).toHaveBeenCalledWith(
				rescheduledJob.name,
				rescheduledJob.nextRunAt,
			);
			expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
				{ _id: job._id, status: JobStatus.PROCESSING, claimedBy: 'test-instance-id' },
				expect.objectContaining({
					$set: expect.objectContaining({ status: JobStatus.PENDING, failCount: 0 }),
				}),
				{ returnDocument: 'after' },
			);
		});

		it('should return null when job is no longer in PROCESSING state', async () => {
			const job = JobFactoryHelpers.processing();

			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(null);

			const result = await lifecycle.completeOwned(job);

			expect(result).toBeNull();
			expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
				{ _id: job._id, status: JobStatus.PROCESSING, claimedBy: 'test-instance-id' },
				expect.any(Object),
				{ returnDocument: 'after' },
			);
		});

		it('should return null for non-persisted jobs (no _id)', async () => {
			const { _id: _, ...jobWithoutId } = JobFactory.build();
			const nonPersistedJob = jobWithoutId as unknown as Parameters<
				typeof lifecycle.completeOwned
			>[0];

			const result = await lifecycle.completeOwned(nonPersistedJob);

			expect(result).toBeNull();
			expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
		});
	});

	describe('failOwned', () => {
		it('should atomically schedule retry with increased failCount when retries remain', async () => {
			const job = JobFactoryHelpers.processing({ failCount: 0 });
			const retriedJob = JobFactoryHelpers.pending({
				_id: job._id,
				name: job.name,
				data: job.data,
				failCount: 1,
				failReason: 'Test failure',
			});
			const error = new Error('Test failure');

			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(retriedJob);

			const result = await lifecycle.failOwned(job, error);

			expect(result).not.toBeNull();
			expect(result?.status).toBe(JobStatus.PENDING);
			expect(result?.failCount).toBe(1);
			expect(ctx.notifyPendingJob).toHaveBeenCalledExactlyOnceWith(
				retriedJob.name,
				retriedJob.nextRunAt,
			);
			expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
				{ _id: job._id, status: JobStatus.PROCESSING, claimedBy: 'test-instance-id' },
				expect.objectContaining({
					$set: expect.objectContaining({
						status: JobStatus.PENDING,
						failCount: 1,
						failReason: 'Test failure',
					}),
				}),
				{ returnDocument: 'after' },
			);
		});

		it('should atomically mark job as failed when max retries exceeded', async () => {
			const job = JobFactoryHelpers.processing({ failCount: 2 });
			const failedJob = JobFactoryHelpers.failed({
				_id: job._id,
				name: job.name,
				data: job.data,
				failCount: 3,
				failReason: 'Final failure',
			});
			const error = new Error('Final failure');

			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(failedJob);

			const result = await lifecycle.failOwned(job, error);

			expect(result).not.toBeNull();
			expect(result?.status).toBe(JobStatus.FAILED);
			expect(result?.failCount).toBe(3);
			expect(ctx.notifyPendingJob).not.toHaveBeenCalled();
			expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
				{ _id: job._id, status: JobStatus.PROCESSING, claimedBy: 'test-instance-id' },
				expect.objectContaining({
					$set: expect.objectContaining({
						status: JobStatus.FAILED,
						failCount: 3,
						failReason: 'Final failure',
					}),
				}),
				{ returnDocument: 'after' },
			);
		});

		it('should return null when job is no longer in PROCESSING state', async () => {
			const job = JobFactoryHelpers.processing({ failCount: 0 });
			const error = new Error('Test failure');

			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(null);

			const result = await lifecycle.failOwned(job, error);

			expect(result).toBeNull();
			expect(ctx.notifyPendingJob).not.toHaveBeenCalled();
			expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
				{ _id: job._id, status: JobStatus.PROCESSING, claimedBy: 'test-instance-id' },
				expect.any(Object),
				{ returnDocument: 'after' },
			);
		});

		it('should return null for non-persisted jobs (no _id)', async () => {
			const { _id: _, ...jobWithoutId } = JobFactory.build();
			const nonPersistedJob = jobWithoutId as unknown as Parameters<typeof lifecycle.failOwned>[0];
			const error = new Error('Test error');

			const result = await lifecycle.failOwned(nonPersistedJob, error);

			expect(result).toBeNull();
			expect(ctx.notifyPendingJob).not.toHaveBeenCalled();
			expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
		});
	});

	describe('updateOwnedHeartbeats', () => {
		it('should not update if scheduler is not running', async () => {
			vi.spyOn(ctx, 'isRunning').mockReturnValue(false);

			await lifecycle.updateOwnedHeartbeats();

			expect(ctx.mockCollection.updateMany).not.toHaveBeenCalled();
		});

		it('should update lastHeartbeat for all jobs claimed by this instance', async () => {
			vi.spyOn(ctx.mockCollection, 'updateMany').mockResolvedValue({
				modifiedCount: 2,
				acknowledged: true,
				upsertedId: null,
				upsertedCount: 0,
				matchedCount: 2,
			});

			await lifecycle.updateOwnedHeartbeats();

			expect(ctx.mockCollection.updateMany).toHaveBeenCalledWith(
				{ claimedBy: 'test-instance-id', status: JobStatus.PROCESSING },
				expect.objectContaining({
					$set: expect.objectContaining({ lastHeartbeat: expect.any(Date) }),
				}),
			);
		});
	});
});
