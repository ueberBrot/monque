/**
 * Unit tests for JobProcessor service.
 *
 * Tests job polling, acquisition, processing, completion, and failure handling.
 * Uses mock SchedulerContext to test processing logic in isolation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockContext, JobFactory, JobFactoryHelpers } from '@tests/factories';
import { JobStatus, type PersistedJob } from '@/jobs';
import { JobProcessor } from '@/scheduler/services/job-processor.js';
import type { WorkerRegistration } from '@/workers';

describe('JobProcessor', () => {
	let ctx: ReturnType<typeof createMockContext>;
	let processor: JobProcessor;

	beforeEach(() => {
		ctx = createMockContext();
		processor = new JobProcessor(ctx);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('poll', () => {
		it('should not poll if scheduler is not running', async () => {
			vi.mocked(ctx.isRunning).mockReturnValue(false);

			await processor.poll();

			expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
		});

		it('should poll for each registered worker with available capacity', async () => {
			const testWorker: WorkerRegistration = {
				handler: vi.fn().mockResolvedValue(undefined),
				concurrency: 2,
				activeJobs: new Map<string, PersistedJob>(),
			};
			ctx.workers.set('test-job', testWorker);

			vi.mocked(ctx.mockCollection.findOneAndUpdate).mockResolvedValue(null);

			await processor.poll();

			// Should have tried to acquire jobs (up to concurrency limit)
			expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalled();
		});

		it('should skip workers at max concurrency', async () => {
			const job = JobFactory.build();
			const testWorker: WorkerRegistration = {
				handler: vi.fn(),
				concurrency: 1,
				activeJobs: new Map<string, PersistedJob>([['job-1', job]]),
			};
			ctx.workers.set('test-job', testWorker);

			await processor.poll();

			// Should not try to acquire for a fully loaded worker
			expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
		});
	});

	describe('acquireJob', () => {
		it('should return null if scheduler is not running', async () => {
			vi.mocked(ctx.isRunning).mockReturnValue(false);

			const job = await processor.acquireJob('test-job');

			expect(job).toBeNull();
			expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
		});

		it('should atomically claim a pending job', async () => {
			const pendingJob = JobFactory.build({ name: 'test-job' });
			vi.mocked(ctx.mockCollection.findOneAndUpdate).mockResolvedValueOnce(pendingJob);

			const job = await processor.acquireJob('test-job');

			expect(job).not.toBeNull();
			expect(job?.name).toBe('test-job');
			expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
				expect.objectContaining({
					name: 'test-job',
					status: JobStatus.PENDING,
					$or: [{ claimedBy: null }, { claimedBy: { $exists: false } }],
				}),
				expect.objectContaining({
					$set: expect.objectContaining({
						status: JobStatus.PROCESSING,
						claimedBy: 'test-instance-id',
					}),
				}),
				expect.any(Object),
			);
		});

		it('should return null when no jobs available', async () => {
			vi.mocked(ctx.mockCollection.findOneAndUpdate).mockResolvedValueOnce(null);

			const job = await processor.acquireJob('test-job');

			expect(job).toBeNull();
		});
	});

	describe('processJob', () => {
		it('should execute handler and emit job:start and job:complete events', async () => {
			const job = JobFactoryHelpers.processing();
			const handler = vi.fn().mockResolvedValue(undefined);
			const worker: WorkerRegistration = {
				handler,
				concurrency: 1,
				activeJobs: new Map<string, PersistedJob>(),
			};

			vi.mocked(ctx.mockCollection.updateOne).mockResolvedValue({
				modifiedCount: 1,
				acknowledged: true,
				upsertedId: null,
				upsertedCount: 0,
				matchedCount: 1,
			});

			await processor.processJob(job, worker);

			expect(handler).toHaveBeenCalledWith(job);
			expect(ctx.emitHistory).toContainEqual(expect.objectContaining({ event: 'job:start' }));
			expect(ctx.emitHistory).toContainEqual(expect.objectContaining({ event: 'job:complete' }));
		});

		it('should call failJob and emit job:fail on handler error', async () => {
			const job = JobFactoryHelpers.processing({ failCount: 0 });
			const handler = vi.fn().mockRejectedValue(new Error('Handler failed'));
			const worker: WorkerRegistration = {
				handler,
				concurrency: 1,
				activeJobs: new Map<string, PersistedJob>(),
			};

			vi.mocked(ctx.mockCollection.updateOne).mockResolvedValue({
				modifiedCount: 1,
				acknowledged: true,
				upsertedId: null,
				upsertedCount: 0,
				matchedCount: 1,
			});

			await processor.processJob(job, worker);

			expect(ctx.emitHistory).toContainEqual(expect.objectContaining({ event: 'job:fail' }));
			const failEvent = ctx.emitHistory.find((e) => e.event === 'job:fail');
			expect((failEvent?.payload as { error: Error })?.error?.message).toBe('Handler failed');
		});

		it('should track job in activeJobs during processing and remove after', async () => {
			const job = JobFactoryHelpers.processing();
			const handler = vi.fn().mockResolvedValue(undefined);
			const worker: WorkerRegistration = {
				handler,
				concurrency: 1,
				activeJobs: new Map<string, PersistedJob>(),
			};

			vi.mocked(ctx.mockCollection.updateOne).mockResolvedValue({
				modifiedCount: 1,
				acknowledged: true,
				upsertedId: null,
				upsertedCount: 0,
				matchedCount: 1,
			});

			await processor.processJob(job, worker);

			// After processing, job should be removed from activeJobs
			expect(worker.activeJobs.size).toBe(0);
		});
	});

	describe('completeJob', () => {
		it('should mark one-time job as completed', async () => {
			const job = JobFactoryHelpers.processing();

			vi.mocked(ctx.mockCollection.updateOne).mockResolvedValue({
				modifiedCount: 1,
				acknowledged: true,
				upsertedId: null,
				upsertedCount: 0,
				matchedCount: 1,
			});

			await processor.completeJob(job);

			expect(ctx.mockCollection.updateOne).toHaveBeenCalledWith(
				{ _id: job._id },
				expect.objectContaining({
					$set: expect.objectContaining({
						status: JobStatus.COMPLETED,
					}),
				}),
			);
		});

		it('should reschedule recurring job with next cron date', async () => {
			const job = JobFactoryHelpers.processing({ repeatInterval: '0 * * * *' });

			vi.mocked(ctx.mockCollection.updateOne).mockResolvedValue({
				modifiedCount: 1,
				acknowledged: true,
				upsertedId: null,
				upsertedCount: 0,
				matchedCount: 1,
			});

			await processor.completeJob(job);

			expect(ctx.mockCollection.updateOne).toHaveBeenCalledWith(
				{ _id: job._id },
				expect.objectContaining({
					$set: expect.objectContaining({
						status: JobStatus.PENDING,
						failCount: 0,
					}),
				}),
			);
		});
	});

	describe('completeJob - edge cases', () => {
		it('should return early for non-persisted jobs (no _id)', async () => {
			// Create a job without _id (not persisted)
			const nonPersistedJob = {
				name: 'test-job',
				data: {},
				status: JobStatus.PROCESSING,
				nextRunAt: new Date(),
				failCount: 0,
				createdAt: new Date(),
				updatedAt: new Date(),
			} as unknown as Parameters<typeof processor.completeJob>[0];

			await processor.completeJob(nonPersistedJob);

			// Should not have tried to update the database
			expect(ctx.mockCollection.updateOne).not.toHaveBeenCalled();
		});
	});

	describe('failJob - edge cases', () => {
		it('should return early for non-persisted jobs (no _id)', async () => {
			// Create a job without _id (not persisted)
			const nonPersistedJob = {
				name: 'test-job',
				data: {},
				status: JobStatus.PROCESSING,
				nextRunAt: new Date(),
				failCount: 0,
				createdAt: new Date(),
				updatedAt: new Date(),
			} as unknown as Parameters<typeof processor.failJob>[0];

			const error = new Error('Test error');
			await processor.failJob(nonPersistedJob, error);

			// Should not have tried to update the database
			expect(ctx.mockCollection.updateOne).not.toHaveBeenCalled();
		});
	});

	describe('failJob', () => {
		it('should schedule retry with increased failCount when retries remain', async () => {
			const job = JobFactoryHelpers.processing({ failCount: 0 });
			const error = new Error('Test failure');

			vi.mocked(ctx.mockCollection.updateOne).mockResolvedValue({
				modifiedCount: 1,
				acknowledged: true,
				upsertedId: null,
				upsertedCount: 0,
				matchedCount: 1,
			});

			await processor.failJob(job, error);

			expect(ctx.mockCollection.updateOne).toHaveBeenCalledWith(
				{ _id: job._id },
				expect.objectContaining({
					$set: expect.objectContaining({
						status: JobStatus.PENDING,
						failCount: 1,
						failReason: 'Test failure',
					}),
				}),
			);
		});

		it('should mark job as failed when max retries exceeded', async () => {
			const job = JobFactoryHelpers.processing({ failCount: 2 }); // maxRetries = 3 in DEFAULT_TEST_OPTIONS
			const error = new Error('Final failure');

			vi.mocked(ctx.mockCollection.updateOne).mockResolvedValue({
				modifiedCount: 1,
				acknowledged: true,
				upsertedId: null,
				upsertedCount: 0,
				matchedCount: 1,
			});

			await processor.failJob(job, error);

			expect(ctx.mockCollection.updateOne).toHaveBeenCalledWith(
				{ _id: job._id },
				expect.objectContaining({
					$set: expect.objectContaining({
						status: JobStatus.FAILED,
						failCount: 3,
						failReason: 'Final failure',
					}),
				}),
			);
		});
	});

	describe('updateHeartbeats', () => {
		it('should not update if scheduler is not running', async () => {
			vi.mocked(ctx.isRunning).mockReturnValue(false);

			await processor.updateHeartbeats();

			expect(ctx.mockCollection.updateMany).not.toHaveBeenCalled();
		});

		it('should update lastHeartbeat for all jobs claimed by this instance', async () => {
			vi.mocked(ctx.mockCollection.updateMany).mockResolvedValue({
				modifiedCount: 2,
				acknowledged: true,
				upsertedId: null,
				upsertedCount: 0,
				matchedCount: 2,
			});

			await processor.updateHeartbeats();

			expect(ctx.mockCollection.updateMany).toHaveBeenCalledWith(
				{
					claimedBy: 'test-instance-id',
					status: JobStatus.PROCESSING,
				},
				expect.objectContaining({
					$set: expect.objectContaining({
						lastHeartbeat: expect.any(Date),
					}),
				}),
			);
		});
	});
});
