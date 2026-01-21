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

			vi.spyOn(ctx.mockCollection, 'findOne').mockResolvedValueOnce(pendingJob);
			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(cancelledJob);

			const job = await manager.cancelJob(jobId.toString());

			expect(job).not.toBeNull();
			expect(job?.status).toBe(JobStatus.CANCELLED);
			expect(ctx.emitHistory).toContainEqual(expect.objectContaining({ event: 'job:cancelled' }));
		});

		it('should return null for non-existent job', async () => {
			vi.spyOn(ctx.mockCollection, 'findOne').mockResolvedValueOnce(null);

			const job = await manager.cancelJob(new ObjectId().toString());

			expect(job).toBeNull();
		});

		it('should throw JobStateError when cancelling a processing job', async () => {
			const jobId = new ObjectId();
			const processingJob = JobFactoryHelpers.processing({ _id: jobId });

			vi.spyOn(ctx.mockCollection, 'findOne').mockResolvedValue(processingJob);

			await expect(manager.cancelJob(jobId.toString())).rejects.toThrow(JobStateError);
		});

		it('should return existing job if already cancelled', async () => {
			const jobId = new ObjectId();
			const cancelledJob = JobFactoryHelpers.cancelled({ _id: jobId });

			vi.spyOn(ctx.mockCollection, 'findOne').mockResolvedValueOnce(cancelledJob);

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

			vi.spyOn(ctx.mockCollection, 'findOne').mockResolvedValueOnce(failedJob);
			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(retriedJob);
			const expectedUnset = {
				failReason: '',
				lockedAt: '',
				claimedBy: '',
				lastHeartbeat: '',
				heartbeatInterval: '',
			};

			const job = await manager.retryJob(jobId.toString());

			expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
				expect.objectContaining({ _id: jobId }),
				expect.objectContaining({ $unset: expectedUnset }),
				expect.anything(),
			);

			expect(job?.status).toBe(JobStatus.PENDING);
			expect(ctx.emitHistory).toContainEqual(expect.objectContaining({ event: 'job:retried' }));
		});

		it('should retry a cancelled job', async () => {
			const jobId = new ObjectId();
			const cancelledJob = JobFactoryHelpers.cancelled({ _id: jobId });
			const retriedJob = JobFactory.build({ _id: jobId });

			vi.spyOn(ctx.mockCollection, 'findOne').mockResolvedValueOnce(cancelledJob);
			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(retriedJob);

			const job = await manager.retryJob(jobId.toString());

			expect(job?.status).toBe(JobStatus.PENDING);
		});

		it('should throw JobStateError when retrying a pending job', async () => {
			const jobId = new ObjectId();
			const pendingJob = JobFactory.build({ _id: jobId });

			vi.spyOn(ctx.mockCollection, 'findOne').mockResolvedValueOnce(pendingJob);

			await expect(manager.retryJob(jobId.toString())).rejects.toThrow(JobStateError);
		});

		it('should return null for non-existent job', async () => {
			vi.spyOn(ctx.mockCollection, 'findOne').mockResolvedValueOnce(null);

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

			vi.spyOn(ctx.mockCollection, 'findOne').mockResolvedValueOnce(pendingJob);
			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(rescheduledJob);

			const job = await manager.rescheduleJob(jobId.toString(), newRunAt);

			expect(job?.nextRunAt).toEqual(newRunAt);
		});

		it('should throw JobStateError when rescheduling a processing job', async () => {
			const jobId = new ObjectId();
			const processingJob = JobFactoryHelpers.processing({ _id: jobId });

			vi.spyOn(ctx.mockCollection, 'findOne').mockResolvedValueOnce(processingJob);

			await expect(manager.rescheduleJob(jobId.toString(), new Date())).rejects.toThrow(
				JobStateError,
			);
		});

		it('should return null for non-existent job', async () => {
			vi.spyOn(ctx.mockCollection, 'findOne').mockResolvedValueOnce(null);

			const job = await manager.rescheduleJob(new ObjectId().toString(), new Date());

			expect(job).toBeNull();
		});
	});

	describe('cancelJob - race conditions', () => {
		it('should throw JobStateError when job status changes during cancellation', async () => {
			const jobId = new ObjectId();
			const pendingJob = JobFactory.build({ _id: jobId });

			// First findOne returns pending job
			vi.spyOn(ctx.mockCollection, 'findOne').mockResolvedValueOnce(pendingJob);
			// But findOneAndUpdate returns null (another process changed the status)
			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(null);

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
			vi.spyOn(ctx.mockCollection, 'findOne').mockResolvedValueOnce(failedJob);
			// But findOneAndUpdate returns null (another process changed the status)
			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(null);

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
			vi.spyOn(ctx.mockCollection, 'findOne').mockResolvedValueOnce(pendingJob);
			// But findOneAndUpdate returns null (another process changed the status)
			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(null);

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

			vi.spyOn(ctx.mockCollection, 'deleteOne').mockResolvedValueOnce({
				deletedCount: 1,
				acknowledged: true,
			});

			const result = await manager.deleteJob(jobId.toString());

			expect(result).toBe(true);
			expect(ctx.emitHistory).toContainEqual(expect.objectContaining({ event: 'job:deleted' }));
		});

		it('should return false for non-existent job', async () => {
			vi.spyOn(ctx.mockCollection, 'deleteOne').mockResolvedValueOnce({
				deletedCount: 0,
				acknowledged: true,
			});

			const result = await manager.deleteJob(new ObjectId().toString());

			expect(result).toBe(false);
		});

		it('should emit job:deleted event with jobId', async () => {
			const jobId = new ObjectId();

			vi.spyOn(ctx.mockCollection, 'deleteOne').mockResolvedValueOnce({
				deletedCount: 1,
				acknowledged: true,
			});

			await manager.deleteJob(jobId.toString());

			const deleteEvent = ctx.emitHistory.find((e) => e.event === 'job:deleted');
			expect(deleteEvent).toBeDefined();
			expect((deleteEvent?.payload as { jobId: string })?.jobId).toBe(jobId.toString());
		});
	});

	// ─────────────────────────────────────────────────────────────────────────────
	// Bulk Operations Tests
	// ─────────────────────────────────────────────────────────────────────────────

	describe('cancelJobs', () => {
		it('should cancel multiple pending jobs', async () => {
			const job1 = JobFactory.build({ name: 'bulk-cancel' });
			const job2 = JobFactory.build({ name: 'bulk-cancel' });

			const mockCursor = {
				[Symbol.asyncIterator]: async function* () {
					yield job1;
					yield job2;
				},
			};

			vi.spyOn(ctx.mockCollection, 'find').mockReturnValueOnce(
				mockCursor as unknown as ReturnType<typeof ctx.mockCollection.find>,
			);
			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate')
				.mockResolvedValueOnce(JobFactoryHelpers.cancelled({ _id: job1._id }))
				.mockResolvedValueOnce(JobFactoryHelpers.cancelled({ _id: job2._id }));

			const result = await manager.cancelJobs({ name: 'bulk-cancel' });

			expect(result.count).toBe(2);
			expect(result.errors).toHaveLength(0);
			expect(ctx.emitHistory).toContainEqual(expect.objectContaining({ event: 'jobs:cancelled' }));
		});

		it('should include already cancelled jobs in count (idempotent)', async () => {
			const cancelledJob = JobFactoryHelpers.cancelled({ name: 'bulk-cancel' });

			const mockCursor = {
				[Symbol.asyncIterator]: async function* () {
					yield cancelledJob;
				},
			};

			vi.spyOn(ctx.mockCollection, 'find').mockReturnValueOnce(
				mockCursor as unknown as ReturnType<typeof ctx.mockCollection.find>,
			);

			const result = await manager.cancelJobs({ name: 'bulk-cancel' });

			expect(result.count).toBe(1);
			expect(result.errors).toHaveLength(0);
			// findOneAndUpdate should NOT be called for already cancelled jobs
			expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
		});

		it('should collect errors for jobs in invalid state', async () => {
			const processingJob = JobFactoryHelpers.processing({ name: 'bulk-cancel' });

			const mockCursor = {
				[Symbol.asyncIterator]: async function* () {
					yield processingJob;
				},
			};

			vi.spyOn(ctx.mockCollection, 'find').mockReturnValueOnce(
				mockCursor as unknown as ReturnType<typeof ctx.mockCollection.find>,
			);

			const result = await manager.cancelJobs({ name: 'bulk-cancel' });

			expect(result.count).toBe(0);
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0]?.error).toMatch(/Cannot cancel job in status 'processing'/);
		});

		it('should handle race condition when job status changes during bulk cancel', async () => {
			const pendingJob = JobFactory.build({ name: 'bulk-cancel' });

			const mockCursor = {
				[Symbol.asyncIterator]: async function* () {
					yield pendingJob;
				},
			};

			vi.spyOn(ctx.mockCollection, 'find').mockReturnValueOnce(
				mockCursor as unknown as ReturnType<typeof ctx.mockCollection.find>,
			);
			// findOneAndUpdate returns null because status changed
			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(null);

			const result = await manager.cancelJobs({ name: 'bulk-cancel' });

			expect(result.count).toBe(0);
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0]?.error).toMatch(/Job status changed during cancellation/);
		});
	});

	describe('retryJobs', () => {
		it('should retry multiple failed jobs', async () => {
			const failedJob1 = JobFactoryHelpers.failed({ name: 'bulk-retry' });
			const failedJob2 = JobFactoryHelpers.failed({ name: 'bulk-retry' });

			const mockCursor = {
				[Symbol.asyncIterator]: async function* () {
					yield failedJob1;
					yield failedJob2;
				},
			};

			vi.spyOn(ctx.mockCollection, 'find').mockReturnValueOnce(
				mockCursor as unknown as ReturnType<typeof ctx.mockCollection.find>,
			);
			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate')
				.mockResolvedValueOnce(JobFactory.build({ _id: failedJob1._id }))
				.mockResolvedValueOnce(JobFactory.build({ _id: failedJob2._id }));

			const expectedUnset = {
				failReason: '',
				lockedAt: '',
				claimedBy: '',
				lastHeartbeat: '',
				heartbeatInterval: '',
			};

			const result = await manager.retryJobs({ status: JobStatus.FAILED });

			expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({ $unset: expectedUnset }),
				expect.anything(),
			);

			expect(result.count).toBe(2);
			expect(result.errors).toHaveLength(0);
			expect(ctx.emitHistory).toContainEqual(expect.objectContaining({ event: 'jobs:retried' }));
		});

		it('should collect errors for jobs in invalid state for retry', async () => {
			const pendingJob = JobFactory.build({ name: 'bulk-retry' });

			const mockCursor = {
				[Symbol.asyncIterator]: async function* () {
					yield pendingJob;
				},
			};

			vi.spyOn(ctx.mockCollection, 'find').mockReturnValueOnce(
				mockCursor as unknown as ReturnType<typeof ctx.mockCollection.find>,
			);

			const result = await manager.retryJobs({ name: 'bulk-retry' });

			expect(result.count).toBe(0);
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0]?.error).toMatch(/Cannot retry job in status 'pending'/);
		});

		it('should handle race condition when job status changes during bulk retry', async () => {
			const failedJob = JobFactoryHelpers.failed({ name: 'bulk-retry' });

			const mockCursor = {
				[Symbol.asyncIterator]: async function* () {
					yield failedJob;
				},
			};

			vi.spyOn(ctx.mockCollection, 'find').mockReturnValueOnce(
				mockCursor as unknown as ReturnType<typeof ctx.mockCollection.find>,
			);
			// findOneAndUpdate returns null because status changed
			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(null);

			const result = await manager.retryJobs({ status: JobStatus.FAILED });

			expect(result.count).toBe(0);
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0]?.error).toMatch(/Job status changed during retry attempt/);
		});
	});

	describe('deleteJobs', () => {
		it('should delete multiple jobs matching filter', async () => {
			vi.spyOn(ctx.mockCollection, 'deleteMany').mockResolvedValueOnce({
				deletedCount: 5,
				acknowledged: true,
			});

			const result = await manager.deleteJobs({ status: JobStatus.COMPLETED });

			expect(result.count).toBe(5);
			expect(result.errors).toHaveLength(0);
			expect(ctx.emitHistory).toContainEqual(
				expect.objectContaining({
					event: 'jobs:deleted',
					payload: { count: 5 },
				}),
			);
		});

		it('should return zero count when no jobs match', async () => {
			vi.spyOn(ctx.mockCollection, 'deleteMany').mockResolvedValueOnce({
				deletedCount: 0,
				acknowledged: true,
			});

			const result = await manager.deleteJobs({ name: 'non-existent' });

			expect(result.count).toBe(0);
			expect(result.errors).toHaveLength(0);
		});
	});
});
