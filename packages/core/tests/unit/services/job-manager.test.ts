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
			expect(ctx.notifyPendingJob).toHaveBeenCalledWith(retriedJob.name, retriedJob.nextRunAt);
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
			expect(ctx.notifyPendingJob).toHaveBeenCalledWith(rescheduledJob.name, newRunAt);
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
		it('should cancel all pending jobs matching filter via updateMany', async () => {
			vi.spyOn(ctx.mockCollection, 'updateMany').mockResolvedValueOnce({
				modifiedCount: 3,
				matchedCount: 3,
				acknowledged: true,
				upsertedCount: 0,
				upsertedId: null,
			});

			const result = await manager.cancelJobs({ name: 'bulk-cancel' });

			expect(ctx.mockCollection.updateMany).toHaveBeenCalledOnce();
			const cancelCall = vi.mocked(ctx.mockCollection.updateMany).mock.calls[0];
			expect(cancelCall).toBeDefined();
			const [query, update] = cancelCall ?? [];
			expect(query).toEqual(expect.objectContaining({ status: 'pending' }));
			expect(update).toEqual(
				expect.objectContaining({
					$set: expect.objectContaining({ status: 'cancelled' }),
				}),
			);
			expect(result).toEqual({ count: 3, errors: [] });
			expect(ctx.emitHistory).toContainEqual(
				expect.objectContaining({ event: 'jobs:cancelled', payload: { count: 3 } }),
			);
		});

		it('should return count 0 when no jobs match', async () => {
			vi.spyOn(ctx.mockCollection, 'updateMany').mockResolvedValueOnce({
				modifiedCount: 0,
				matchedCount: 0,
				acknowledged: true,
				upsertedCount: 0,
				upsertedId: null,
			});

			const result = await manager.cancelJobs({ name: 'no-match' });

			expect(result).toEqual({ count: 0, errors: [] });
			expect(ctx.emitHistory).not.toContainEqual(
				expect.objectContaining({ event: 'jobs:cancelled' }),
			);
		});

		it('should return count 0 when filter status does not include pending', async () => {
			vi.spyOn(ctx.mockCollection, 'updateMany').mockResolvedValueOnce({
				modifiedCount: 0,
				matchedCount: 0,
				acknowledged: true,
				upsertedCount: 0,
				upsertedId: null,
			});

			const result = await manager.cancelJobs({ status: JobStatus.PROCESSING });

			expect(result).toEqual({ count: 0, errors: [] });
			expect(ctx.mockCollection.updateMany).not.toHaveBeenCalled();
		});

		it('should cancel jobs when filter status includes pending', async () => {
			vi.spyOn(ctx.mockCollection, 'updateMany').mockResolvedValueOnce({
				modifiedCount: 3,
				matchedCount: 3,
				acknowledged: true,
				upsertedCount: 0,
				upsertedId: null,
			});

			const result = await manager.cancelJobs({ status: JobStatus.PENDING });

			expect(ctx.mockCollection.updateMany).toHaveBeenCalledOnce();
			const call = vi.mocked(ctx.mockCollection.updateMany).mock.calls[0];
			expect(call).toBeDefined();
			const [query] = call ?? [];
			expect(query).toEqual(expect.objectContaining({ status: 'pending' }));
			expect(result).toEqual({ count: 3, errors: [] });
		});
	});

	describe('retryJobs', () => {
		it('should retry all failed/cancelled jobs via updateMany with pipeline', async () => {
			vi.spyOn(ctx.mockCollection, 'updateMany').mockResolvedValueOnce({
				modifiedCount: 5,
				matchedCount: 5,
				acknowledged: true,
				upsertedCount: 0,
				upsertedId: null,
			});

			const result = await manager.retryJobs({});

			expect(ctx.mockCollection.updateMany).toHaveBeenCalledOnce();
			const retryCall = vi.mocked(ctx.mockCollection.updateMany).mock.calls[0];
			expect(retryCall).toBeDefined();
			const [query, update] = retryCall ?? [];
			expect(query).toEqual(expect.objectContaining({ status: { $in: ['failed', 'cancelled'] } }));
			// Pipeline-style update: second argument must be an array
			expect(Array.isArray(update)).toBe(true);
			expect(result).toEqual({ count: 5, errors: [] });
			expect(ctx.emitHistory).toContainEqual(
				expect.objectContaining({ event: 'jobs:retried', payload: { count: 5 } }),
			);
		});

		it('should respect explicit status filter and intersect with retryable statuses', async () => {
			vi.spyOn(ctx.mockCollection, 'updateMany').mockResolvedValueOnce({
				modifiedCount: 3,
				matchedCount: 3,
				acknowledged: true,
				upsertedCount: 0,
				upsertedId: null,
			});

			const result = await manager.retryJobs({ status: JobStatus.FAILED });

			expect(ctx.mockCollection.updateMany).toHaveBeenCalledOnce();
			const retryCall = vi.mocked(ctx.mockCollection.updateMany).mock.calls[0];
			expect(retryCall).toBeDefined();
			const [query] = retryCall ?? [];
			expect(query).toEqual(expect.objectContaining({ status: 'failed' }));
			expect(result).toEqual({ count: 3, errors: [] });
		});

		it('should return count 0 when filter status does not include retryable statuses', async () => {
			const result = await manager.retryJobs({ status: JobStatus.COMPLETED });

			expect(result).toEqual({ count: 0, errors: [] });
			expect(ctx.mockCollection.updateMany).not.toHaveBeenCalled();
		});

		it('should return count 0 when no jobs match', async () => {
			vi.spyOn(ctx.mockCollection, 'updateMany').mockResolvedValueOnce({
				modifiedCount: 0,
				matchedCount: 0,
				acknowledged: true,
				upsertedCount: 0,
				upsertedId: null,
			});

			const result = await manager.retryJobs({ name: 'no-match' });

			expect(result).toEqual({ count: 0, errors: [] });
			expect(ctx.emitHistory).not.toContainEqual(
				expect.objectContaining({ event: 'jobs:retried' }),
			);
		});

		it('should use pipeline-style update with $rand stagger', async () => {
			vi.spyOn(ctx.mockCollection, 'updateMany').mockResolvedValueOnce({
				modifiedCount: 1,
				matchedCount: 1,
				acknowledged: true,
				upsertedCount: 0,
				upsertedId: null,
			});

			await manager.retryJobs({ status: JobStatus.FAILED });

			const pipelineCall = vi.mocked(ctx.mockCollection.updateMany).mock.calls[0];
			expect(pipelineCall).toBeDefined();
			const [, update] = pipelineCall ?? [];
			const pipeline = update as Record<string, unknown>[];
			const setStage = pipeline[0] as { $set: Record<string, unknown> };
			expect(setStage).toHaveProperty('$set');
			expect(setStage.$set).toHaveProperty('nextRunAt');
			const nextRunAt = setStage.$set['nextRunAt'] as Record<string, unknown>;
			expect(nextRunAt).toHaveProperty('$add');
			const addExpr = nextRunAt['$add'] as unknown[];
			expect(addExpr).toHaveLength(2);
			const multiplyExpr = addExpr[1] as Record<string, unknown>;
			expect(multiplyExpr).toHaveProperty('$multiply');
			const multiplyArgs = multiplyExpr['$multiply'] as unknown[];
			expect(multiplyArgs).toContainEqual({ $rand: {} });
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
