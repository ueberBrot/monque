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
			vi.spyOn(ctx, 'isRunning').mockReturnValue(false);

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

			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValue(null);

			await processor.poll();

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

			expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
		});

		it('should exit early when instanceConcurrency is reached', async () => {
			ctx.options.instanceConcurrency = 2;

			const job1 = JobFactory.build();
			const job2 = JobFactory.build();

			const worker1: WorkerRegistration = {
				handler: vi.fn().mockResolvedValue(undefined),
				concurrency: 5,
				activeJobs: new Map<string, PersistedJob>([['job-1', job1]]),
			};
			const worker2: WorkerRegistration = {
				handler: vi.fn().mockResolvedValue(undefined),
				concurrency: 5,
				activeJobs: new Map<string, PersistedJob>([['job-2', job2]]),
			};
			ctx.workers.set('worker-1', worker1);
			ctx.workers.set('worker-2', worker2);

			await processor.poll();

			// Should not attempt any acquisitions since instanceConcurrency (2) is already reached
			expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
		});

		it('should limit job acquisition to available global slots', async () => {
			ctx.options.instanceConcurrency = 3;

			const job1 = JobFactory.build();
			const newJob = JobFactory.build({ name: 'worker-2' });

			const worker1: WorkerRegistration = {
				handler: vi.fn().mockResolvedValue(undefined),
				concurrency: 5,
				activeJobs: new Map<string, PersistedJob>([['job-1', job1]]),
			};
			const worker2: WorkerRegistration = {
				handler: vi.fn().mockResolvedValue(undefined),
				concurrency: 5,
				activeJobs: new Map<string, PersistedJob>(),
			};
			ctx.workers.set('worker-1', worker1);
			ctx.workers.set('worker-2', worker2);

			// Return job on first call, null on subsequent calls
			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate')
				.mockResolvedValueOnce(newJob)
				.mockResolvedValueOnce(null);

			await processor.poll();

			// With 1 active job and instanceConcurrency 3, only 2 more slots available globally
			// Worker-1 has 4 worker slots but global limit is 2
			// Should attempt acquisitions up to the global limit
			expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalled();
		});

		it('should stop acquiring jobs when global limit is reached mid-poll', async () => {
			ctx.options.instanceConcurrency = 2;

			const newJob1 = JobFactory.build({ name: 'test-job' });
			const newJob2 = JobFactory.build({ name: 'test-job' });

			const worker: WorkerRegistration = {
				handler: vi.fn().mockResolvedValue(undefined),
				concurrency: 10,
				activeJobs: new Map<string, PersistedJob>(),
			};
			ctx.workers.set('test-job', worker);

			const spy = vi
				.spyOn(ctx.mockCollection, 'findOneAndUpdate')
				.mockResolvedValueOnce(newJob1)
				.mockResolvedValueOnce(newJob2)
				.mockResolvedValue(null);

			await processor.poll();

			// Should acquire exactly 2 jobs (the instanceConcurrency limit).
			// completeJob/failJob also call findOneAndUpdate, so count only acquire calls
			// (filter contains status: 'pending').
			const acquireCalls = spy.mock.calls.filter(
				(args) =>
					typeof args[0] === 'object' &&
					args[0] !== null &&
					'status' in args[0] &&
					args[0]['status'] === JobStatus.PENDING,
			);
			expect(acquireCalls).toHaveLength(2);
		});

		it('should work without instanceConcurrency (unlimited)', async () => {
			// instanceConcurrency is undefined by default
			expect(ctx.options.instanceConcurrency).toBeUndefined();

			const testWorker: WorkerRegistration = {
				handler: vi.fn().mockResolvedValue(undefined),
				concurrency: 3,
				activeJobs: new Map<string, PersistedJob>(),
			};
			ctx.workers.set('test-job', testWorker);

			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValue(null);

			await processor.poll();

			// Should try to acquire up to worker concurrency (3 attempts until null)
			expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalledTimes(1);
		});
	});

	describe('acquireJob', () => {
		it('should return null if scheduler is not running', async () => {
			vi.spyOn(ctx, 'isRunning').mockReturnValue(false);

			const job = await processor.acquireJob('test-job');

			expect(job).toBeNull();
			expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
		});

		it('should atomically claim a pending job', async () => {
			const pendingJob = JobFactory.build({ name: 'test-job' });
			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(pendingJob);

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
			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(null);

			const job = await processor.acquireJob('test-job');

			expect(job).toBeNull();
		});
	});

	describe('processJob', () => {
		it('should execute handler and emit job:start and job:complete events', async () => {
			const job = JobFactoryHelpers.processing();
			const completedJob = JobFactoryHelpers.completed({
				_id: job._id,
				name: job.name,
				data: job.data,
			});
			const handler = vi.fn().mockResolvedValue(undefined);
			const worker: WorkerRegistration = {
				handler,
				concurrency: 1,
				activeJobs: new Map<string, PersistedJob>(),
			};

			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(completedJob);

			await processor.processJob(job, worker);

			expect(handler).toHaveBeenCalledWith(job);
			expect(ctx.emitHistory).toContainEqual(expect.objectContaining({ event: 'job:start' }));
			expect(ctx.emitHistory).toContainEqual(expect.objectContaining({ event: 'job:complete' }));
		});

		it('should emit job:complete with the actual DB document, not the stale in-memory job', async () => {
			const job = JobFactoryHelpers.processing();
			const completedJob = JobFactoryHelpers.completed({
				_id: job._id,
				name: job.name,
				data: job.data,
			});
			const handler = vi.fn().mockResolvedValue(undefined);
			const worker: WorkerRegistration = {
				handler,
				concurrency: 1,
				activeJobs: new Map<string, PersistedJob>(),
			};

			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(completedJob);

			await processor.processJob(job, worker);

			const completeEvent = ctx.emitHistory.find((e) => e.event === 'job:complete');
			const payload = completeEvent?.payload as { job: PersistedJob; duration: number };
			expect(payload.job.status).toBe(JobStatus.COMPLETED);
			expect(payload.job._id).toEqual(job._id);
		});

		it('should call failJob and emit job:fail on handler error', async () => {
			const job = JobFactoryHelpers.processing({ failCount: 0 });
			const failedJob = JobFactoryHelpers.pending({
				_id: job._id,
				name: job.name,
				data: job.data,
				failCount: 1,
				failReason: 'Handler failed',
			});
			const handler = vi.fn().mockRejectedValue(new Error('Handler failed'));
			const worker: WorkerRegistration = {
				handler,
				concurrency: 1,
				activeJobs: new Map<string, PersistedJob>(),
			};

			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(failedJob);

			await processor.processJob(job, worker);

			expect(ctx.emitHistory).toContainEqual(expect.objectContaining({ event: 'job:fail' }));
			const failEvent = ctx.emitHistory.find((e) => e.event === 'job:fail');
			expect((failEvent?.payload as { error: Error })?.error?.message).toBe('Handler failed');
		});

		it('should coerce non-Error thrown values to Error objects', async () => {
			const job = JobFactoryHelpers.processing({ failCount: 0 });
			const failedJob = JobFactoryHelpers.pending({
				_id: job._id,
				name: job.name,
				data: job.data,
				failCount: 1,
				failReason: 'String error message',
			});
			const handler = vi.fn().mockRejectedValue('String error message');
			const worker: WorkerRegistration = {
				handler,
				concurrency: 1,
				activeJobs: new Map<string, PersistedJob>(),
			};

			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(failedJob);

			await processor.processJob(job, worker);

			expect(ctx.emitHistory).toContainEqual(expect.objectContaining({ event: 'job:fail' }));
			const failEvent = ctx.emitHistory.find((e) => e.event === 'job:fail');
			const payload = failEvent?.payload as { error: Error };
			expect(payload.error).toBeInstanceOf(Error);
			expect(payload.error.message).toBe('String error message');
		});

		it('should track job in activeJobs during processing and remove after', async () => {
			const job = JobFactoryHelpers.processing();
			const completedJob = JobFactoryHelpers.completed({
				_id: job._id,
				name: job.name,
				data: job.data,
			});
			const handler = vi.fn().mockResolvedValue(undefined);
			const worker: WorkerRegistration = {
				handler,
				concurrency: 1,
				activeJobs: new Map<string, PersistedJob>(),
			};

			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(completedJob);

			await processor.processJob(job, worker);

			expect(worker.activeJobs.size).toBe(0);
		});

		it('should not emit job:complete when completeJob returns null (race condition)', async () => {
			const job = JobFactoryHelpers.processing();
			const handler = vi.fn().mockResolvedValue(undefined);
			const worker: WorkerRegistration = {
				handler,
				concurrency: 1,
				activeJobs: new Map<string, PersistedJob>(),
			};

			// completeJob returns null (job was deleted or status changed concurrently)
			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(null);

			await processor.processJob(job, worker);

			expect(ctx.emitHistory).toContainEqual(expect.objectContaining({ event: 'job:start' }));
			expect(ctx.emitHistory).not.toContainEqual(
				expect.objectContaining({ event: 'job:complete' }),
			);
		});

		it('should not emit job:fail when failJob returns null (race condition)', async () => {
			const job = JobFactoryHelpers.processing({ failCount: 0 });
			const handler = vi.fn().mockRejectedValue(new Error('Handler failed'));
			const worker: WorkerRegistration = {
				handler,
				concurrency: 1,
				activeJobs: new Map<string, PersistedJob>(),
			};

			// failJob returns null (job was deleted or status changed concurrently)
			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(null);

			await processor.processJob(job, worker);

			expect(ctx.emitHistory).toContainEqual(expect.objectContaining({ event: 'job:start' }));
			expect(ctx.emitHistory).not.toContainEqual(expect.objectContaining({ event: 'job:fail' }));
		});

		it('should derive willRetry from actual DB status (PENDING = retry, FAILED = no retry)', async () => {
			// Case 1: Job will retry (status reset to PENDING)
			const job1 = JobFactoryHelpers.processing({ failCount: 0 });
			const retriedJob = JobFactoryHelpers.pending({
				_id: job1._id,
				name: job1.name,
				data: job1.data,
				failCount: 1,
			});
			const handler1 = vi.fn().mockRejectedValue(new Error('Fail'));
			const worker1: WorkerRegistration = {
				handler: handler1,
				concurrency: 1,
				activeJobs: new Map<string, PersistedJob>(),
			};

			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(retriedJob);

			await processor.processJob(job1, worker1);

			const retryEvent = ctx.emitHistory.find((e) => e.event === 'job:fail');
			expect((retryEvent?.payload as { willRetry: boolean })?.willRetry).toBe(true);

			// Reset for case 2
			ctx.emitHistory.length = 0;

			// Case 2: Job permanently failed (status set to FAILED)
			const job2 = JobFactoryHelpers.processing({ failCount: 2 });
			const permanentlyFailedJob = JobFactoryHelpers.failed({
				_id: job2._id,
				name: job2.name,
				data: job2.data,
				failCount: 3,
			});
			const handler2 = vi.fn().mockRejectedValue(new Error('Fail'));
			const worker2: WorkerRegistration = {
				handler: handler2,
				concurrency: 1,
				activeJobs: new Map<string, PersistedJob>(),
			};

			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(permanentlyFailedJob);

			await processor.processJob(job2, worker2);

			const failEvent = ctx.emitHistory.find((e) => e.event === 'job:fail');
			expect((failEvent?.payload as { willRetry: boolean })?.willRetry).toBe(false);
		});

		it('should still remove job from activeJobs even when transition returns null', async () => {
			const job = JobFactoryHelpers.processing();
			const handler = vi.fn().mockResolvedValue(undefined);
			const worker: WorkerRegistration = {
				handler,
				concurrency: 1,
				activeJobs: new Map<string, PersistedJob>(),
			};

			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(null);

			await processor.processJob(job, worker);

			expect(worker.activeJobs.size).toBe(0);
		});
	});

	describe('completeJob', () => {
		it('should atomically mark one-time job as completed', async () => {
			const job = JobFactoryHelpers.processing();
			const completedJob = JobFactoryHelpers.completed({
				_id: job._id,
				name: job.name,
				data: job.data,
			});

			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(completedJob);

			const result = await processor.completeJob(job);

			expect(result).not.toBeNull();
			expect(result?.status).toBe(JobStatus.COMPLETED);
			expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
				{ _id: job._id, status: JobStatus.PROCESSING },
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

			const result = await processor.completeJob(job);

			expect(result).not.toBeNull();
			expect(result?.status).toBe(JobStatus.PENDING);
			expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
				{ _id: job._id, status: JobStatus.PROCESSING },
				expect.objectContaining({
					$set: expect.objectContaining({ status: JobStatus.PENDING, failCount: 0 }),
				}),
				{ returnDocument: 'after' },
			);
		});

		it('should return null when job is no longer in PROCESSING state', async () => {
			const job = JobFactoryHelpers.processing();

			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(null);

			const result = await processor.completeJob(job);

			expect(result).toBeNull();
			expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
				{ _id: job._id, status: JobStatus.PROCESSING },
				expect.any(Object),
				{ returnDocument: 'after' },
			);
		});
	});

	describe('completeJob - edge cases', () => {
		it('should return null for non-persisted jobs (no _id)', async () => {
			const nonPersistedJob = {
				name: 'test-job',
				data: {},
				status: JobStatus.PROCESSING,
				nextRunAt: new Date(),
				failCount: 0,
				createdAt: new Date(),
				updatedAt: new Date(),
			} as unknown as Parameters<typeof processor.completeJob>[0];

			const result = await processor.completeJob(nonPersistedJob);

			expect(result).toBeNull();
			expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
		});
	});

	describe('failJob - edge cases', () => {
		it('should return null for non-persisted jobs (no _id)', async () => {
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
			const result = await processor.failJob(nonPersistedJob, error);

			expect(result).toBeNull();
			expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
		});
	});

	describe('failJob', () => {
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

			const result = await processor.failJob(job, error);

			expect(result).not.toBeNull();
			expect(result?.status).toBe(JobStatus.PENDING);
			expect(result?.failCount).toBe(1);
			expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
				{ _id: job._id, status: JobStatus.PROCESSING },
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

			const result = await processor.failJob(job, error);

			expect(result).not.toBeNull();
			expect(result?.status).toBe(JobStatus.FAILED);
			expect(result?.failCount).toBe(3);
			expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
				{ _id: job._id, status: JobStatus.PROCESSING },
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

			const result = await processor.failJob(job, error);

			expect(result).toBeNull();
			expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
				{ _id: job._id, status: JobStatus.PROCESSING },
				expect.any(Object),
				{ returnDocument: 'after' },
			);
		});
	});

	describe('updateHeartbeats', () => {
		it('should not update if scheduler is not running', async () => {
			vi.spyOn(ctx, 'isRunning').mockReturnValue(false);

			await processor.updateHeartbeats();

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

			await processor.updateHeartbeats();

			expect(ctx.mockCollection.updateMany).toHaveBeenCalledWith(
				{ claimedBy: 'test-instance-id', status: JobStatus.PROCESSING },
				expect.objectContaining({
					$set: expect.objectContaining({ lastHeartbeat: expect.any(Date) }),
				}),
			);
		});
	});
});
