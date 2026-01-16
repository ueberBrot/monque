/**
 * Unit tests for JobManager service.
 *
 * Tests job management operations: cancel, retry, reschedule, delete.
 * Uses mock SchedulerContext to test state transition logic in isolation.
 */

import { ObjectId } from 'mongodb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockContext, JobFactory, JobFactoryHelpers } from '@tests/factories';
import { JobStatus } from '@/jobs';
import { JobManager } from '@/scheduler/services/job-manager.js';
import { JobStateError } from '@/shared';

describe('JobManager', () => {
	let ctx: ReturnType<typeof createMockContext>;
	let manager: JobManager;

	beforeEach(() => {
		ctx = createMockContext();
		manager = new JobManager(ctx);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('cancelJob', () => {
		it('should cancel a pending job', async () => {
			const jobId = new ObjectId();
			const pendingJob = JobFactory.build({ _id: jobId, name: 'cancel-test' });
			const cancelledJob = JobFactoryHelpers.cancelled({ _id: jobId, name: 'cancel-test' });

			vi.mocked(ctx.mockCollection.findOne).mockResolvedValueOnce(pendingJob);
			vi.mocked(ctx.mockCollection.findOneAndUpdate).mockResolvedValueOnce(cancelledJob);

			const job = await manager.cancelJob(jobId.toString());

			expect(job).not.toBeNull();
			expect(job?.status).toBe(JobStatus.CANCELLED);
			expect(ctx.emitHistory).toContainEqual(expect.objectContaining({ event: 'job:cancelled' }));
		});

		it('should return null for non-existent job', async () => {
			vi.mocked(ctx.mockCollection.findOne).mockResolvedValueOnce(null);

			const job = await manager.cancelJob(new ObjectId().toString());

			expect(job).toBeNull();
		});

		it('should throw JobStateError when cancelling a processing job', async () => {
			const jobId = new ObjectId();
			const processingJob = JobFactoryHelpers.processing({ _id: jobId });

			vi.mocked(ctx.mockCollection.findOne).mockResolvedValue(processingJob);

			await expect(manager.cancelJob(jobId.toString())).rejects.toThrow(JobStateError);
		});

		it('should return existing job if already cancelled', async () => {
			const jobId = new ObjectId();
			const cancelledJob = JobFactoryHelpers.cancelled({ _id: jobId });

			vi.mocked(ctx.mockCollection.findOne).mockResolvedValueOnce(cancelledJob);

			const job = await manager.cancelJob(jobId.toString());

			expect(job?.status).toBe(JobStatus.CANCELLED);
			expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
		});
	});

	describe('retryJob', () => {
		it('should retry a failed job', async () => {
			const jobId = new ObjectId();
			const failedJob = JobFactoryHelpers.failed({ _id: jobId });
			const retriedJob = JobFactory.build({ _id: jobId, failCount: 0 });

			vi.mocked(ctx.mockCollection.findOne).mockResolvedValueOnce(failedJob);
			vi.mocked(ctx.mockCollection.findOneAndUpdate).mockResolvedValueOnce(retriedJob);

			const job = await manager.retryJob(jobId.toString());

			expect(job?.status).toBe(JobStatus.PENDING);
			expect(ctx.emitHistory).toContainEqual(expect.objectContaining({ event: 'job:retried' }));
		});

		it('should retry a cancelled job', async () => {
			const jobId = new ObjectId();
			const cancelledJob = JobFactoryHelpers.cancelled({ _id: jobId });
			const retriedJob = JobFactory.build({ _id: jobId });

			vi.mocked(ctx.mockCollection.findOne).mockResolvedValueOnce(cancelledJob);
			vi.mocked(ctx.mockCollection.findOneAndUpdate).mockResolvedValueOnce(retriedJob);

			const job = await manager.retryJob(jobId.toString());

			expect(job?.status).toBe(JobStatus.PENDING);
		});

		it('should throw JobStateError when retrying a pending job', async () => {
			const jobId = new ObjectId();
			const pendingJob = JobFactory.build({ _id: jobId });

			vi.mocked(ctx.mockCollection.findOne).mockResolvedValueOnce(pendingJob);

			await expect(manager.retryJob(jobId.toString())).rejects.toThrow(JobStateError);
		});

		it('should return null for non-existent job', async () => {
			vi.mocked(ctx.mockCollection.findOne).mockResolvedValueOnce(null);

			const job = await manager.retryJob(new ObjectId().toString());

			expect(job).toBeNull();
		});
	});

	describe('rescheduleJob', () => {
		it('should reschedule a pending job to new time', async () => {
			const jobId = new ObjectId();
			const newRunAt = new Date(Date.now() + 3600000);
			const pendingJob = JobFactory.build({ _id: jobId });
			const rescheduledJob = JobFactory.build({ _id: jobId, nextRunAt: newRunAt });

			vi.mocked(ctx.mockCollection.findOne).mockResolvedValueOnce(pendingJob);
			vi.mocked(ctx.mockCollection.findOneAndUpdate).mockResolvedValueOnce(rescheduledJob);

			const job = await manager.rescheduleJob(jobId.toString(), newRunAt);

			expect(job?.nextRunAt).toEqual(newRunAt);
		});

		it('should throw JobStateError when rescheduling a processing job', async () => {
			const jobId = new ObjectId();
			const processingJob = JobFactoryHelpers.processing({ _id: jobId });

			vi.mocked(ctx.mockCollection.findOne).mockResolvedValueOnce(processingJob);

			await expect(manager.rescheduleJob(jobId.toString(), new Date())).rejects.toThrow(
				JobStateError,
			);
		});

		it('should return null for non-existent job', async () => {
			vi.mocked(ctx.mockCollection.findOne).mockResolvedValueOnce(null);

			const job = await manager.rescheduleJob(new ObjectId().toString(), new Date());

			expect(job).toBeNull();
		});
	});

	describe('cancelJob - race conditions', () => {
		it('should throw JobStateError when job status changes during cancellation', async () => {
			const jobId = new ObjectId();
			const pendingJob = JobFactory.build({ _id: jobId });

			// First findOne returns pending job
			vi.mocked(ctx.mockCollection.findOne).mockResolvedValueOnce(pendingJob);
			// But findOneAndUpdate returns null (another process changed the status)
			vi.mocked(ctx.mockCollection.findOneAndUpdate).mockResolvedValueOnce(null);

			const error = await manager.cancelJob(jobId.toString()).catch((e: unknown) => e);
			expect(error).toBeInstanceOf(JobStateError);
			expect((error as JobStateError).message).toMatch(
				/Job status changed during cancellation attempt/,
			);
		});
	});

	describe('retryJob - race conditions', () => {
		it('should throw JobStateError when job status changes during retry', async () => {
			const jobId = new ObjectId();
			const failedJob = JobFactoryHelpers.failed({ _id: jobId });

			// First findOne returns failed job
			vi.mocked(ctx.mockCollection.findOne).mockResolvedValueOnce(failedJob);
			// But findOneAndUpdate returns null (another process changed the status)
			vi.mocked(ctx.mockCollection.findOneAndUpdate).mockResolvedValueOnce(null);

			const error = await manager.retryJob(jobId.toString()).catch((e: unknown) => e);
			expect(error).toBeInstanceOf(JobStateError);
			expect((error as JobStateError).message).toMatch(/Job status changed during retry attempt/);
		});
	});

	describe('rescheduleJob - race conditions', () => {
		it('should throw JobStateError when job status changes during reschedule', async () => {
			const jobId = new ObjectId();
			const newRunAt = new Date(Date.now() + 3600000);
			const pendingJob = JobFactory.build({ _id: jobId });

			// First findOne returns pending job
			vi.mocked(ctx.mockCollection.findOne).mockResolvedValueOnce(pendingJob);
			// But findOneAndUpdate returns null (another process changed the status)
			vi.mocked(ctx.mockCollection.findOneAndUpdate).mockResolvedValueOnce(null);

			const error = await manager
				.rescheduleJob(jobId.toString(), newRunAt)
				.catch((e: unknown) => e);
			expect(error).toBeInstanceOf(JobStateError);
			expect((error as JobStateError).message).toMatch(
				/Job status changed during reschedule attempt/,
			);
		});
	});

	describe('deleteJob', () => {
		it('should delete job and return true', async () => {
			const jobId = new ObjectId();
			const jobDoc = JobFactory.build({ _id: jobId });

			vi.mocked(ctx.mockCollection.findOne).mockResolvedValueOnce(jobDoc);
			vi.mocked(ctx.mockCollection.deleteOne).mockResolvedValueOnce({
				deletedCount: 1,
				acknowledged: true,
			});

			const result = await manager.deleteJob(jobId.toString());

			expect(result).toBe(true);
			expect(ctx.emitHistory).toContainEqual(expect.objectContaining({ event: 'job:deleted' }));
		});

		it('should return false for non-existent job', async () => {
			vi.mocked(ctx.mockCollection.findOne).mockResolvedValueOnce(null);

			const result = await manager.deleteJob(new ObjectId().toString());

			expect(result).toBe(false);
		});

		it('should return false when job deleted between findOne and deleteOne (race condition)', async () => {
			const jobId = new ObjectId();
			const jobDoc = JobFactory.build({ _id: jobId });

			vi.mocked(ctx.mockCollection.findOne).mockResolvedValueOnce(jobDoc);
			// Another process deleted the job between findOne and deleteOne
			vi.mocked(ctx.mockCollection.deleteOne).mockResolvedValueOnce({
				deletedCount: 0,
				acknowledged: true,
			});

			const result = await manager.deleteJob(jobId.toString());

			expect(result).toBe(false);
			expect(ctx.emitHistory.find((e) => e.event === 'job:deleted')).toBeUndefined();
		});

		it('should emit job:deleted event with jobId', async () => {
			const jobId = new ObjectId();
			const jobDoc = JobFactory.build({ _id: jobId, name: 'delete-test' });

			vi.mocked(ctx.mockCollection.findOne).mockResolvedValueOnce(jobDoc);
			vi.mocked(ctx.mockCollection.deleteOne).mockResolvedValueOnce({
				deletedCount: 1,
				acknowledged: true,
			});

			await manager.deleteJob(jobId.toString());

			const deleteEvent = ctx.emitHistory.find((e) => e.event === 'job:deleted');
			expect(deleteEvent).toBeDefined();
			expect((deleteEvent?.payload as { jobId: string })?.jobId).toBe(jobId.toString());
		});
	});
});
