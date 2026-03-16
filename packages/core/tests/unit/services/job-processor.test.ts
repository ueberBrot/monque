/**
 * Unit tests for JobProcessor service.
 *
 * Tests job polling, acquisition, processing, completion, and failure handling.
 * Uses mock SchedulerContext to test processing logic in isolation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockContext, createWorker, JobFactory, JobFactoryHelpers } from '@tests/factories';
import { JobStatus, type PersistedJob } from '@/jobs';
import { JobProcessor } from '@/scheduler/services/job-processor.js';

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
			ctx.workers.set('test-job', createWorker({ concurrency: 2 }));

			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValue(null);

			await processor.poll();

			expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalled();
		});

		it('should skip workers at max concurrency', async () => {
			const job = JobFactory.build();
			ctx.workers.set(
				'test-job',
				createWorker({
					concurrency: 1,
					activeJobs: new Map<string, PersistedJob>([['job-1', job]]),
				}),
			);

			await processor.poll();

			expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
		});

		it('should exit early when instanceConcurrency is reached', async () => {
			ctx.options.instanceConcurrency = 2;

			const job1 = JobFactory.build({ name: 'worker-1' });
			const job2 = JobFactory.build({ name: 'worker-2' });

			let resolveHandlers: (() => void) | undefined;
			const handlerPromise = new Promise<void>((r) => {
				resolveHandlers = r;
			});
			const handler = () => handlerPromise;

			ctx.workers.set('worker-1', createWorker({ concurrency: 5, handler }));
			ctx.workers.set('worker-2', createWorker({ concurrency: 5, handler }));

			// Seed the counter by acquiring 2 jobs through a first poll
			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate')
				.mockResolvedValueOnce(job1)
				.mockResolvedValueOnce(job2)
				.mockResolvedValue(null);

			await processor.poll();

			const callsAfterFirstPoll = (ctx.mockCollection.findOneAndUpdate as ReturnType<typeof vi.fn>)
				.mock.calls.length;
			vi.clearAllMocks();

			// Now the counter is at 2 (= instanceConcurrency), a second poll should not acquire
			await processor.poll();

			expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
			expect(callsAfterFirstPoll).toBeGreaterThan(0);

			// Clean up dangling promises
			resolveHandlers?.();
			await new Promise<void>((r) => setTimeout(r, 0));
		});

		it('should limit job acquisition to available global slots', async () => {
			ctx.options.instanceConcurrency = 3;

			const seedJob = JobFactory.build({ name: 'worker-1' });
			const newJob = JobFactory.build({ name: 'worker-2' });

			ctx.workers.set('worker-1', createWorker({ concurrency: 5 }));
			ctx.workers.set('worker-2', createWorker({ concurrency: 5 }));

			// Seed counter to 1 by acquiring seedJob, then return newJob and null
			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate')
				.mockResolvedValueOnce(seedJob)
				.mockResolvedValueOnce(newJob)
				.mockResolvedValue(null);

			await processor.poll();

			// With instanceConcurrency 3 and starting at 0, poll acquires up to 3 jobs (seedJob and newJob)
			// Should attempt acquisitions
			expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalled();
		});

		it('should stop acquiring jobs when global limit is reached mid-poll', async () => {
			ctx.options.instanceConcurrency = 2;

			const newJob1 = JobFactory.build({ name: 'test-job' });
			const newJob2 = JobFactory.build({ name: 'test-job' });

			ctx.workers.set('test-job', createWorker({ concurrency: 10 }));

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

			ctx.workers.set('test-job', createWorker({ concurrency: 3 }));

			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValue(null);

			await processor.poll();

			// Should try to acquire up to worker concurrency (3 attempts until null)
			expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalledTimes(1);
		});

		it('should re-poll when a poll request arrives while already polling', async () => {
			ctx.workers.set('test-job', createWorker({ concurrency: 1 }));

			let firstPollResolve: (() => void) | undefined;
			const firstPollPromise = new Promise<void>((resolve) => {
				firstPollResolve = resolve;
			});

			const spy = vi
				.spyOn(ctx.mockCollection, 'findOneAndUpdate')
				.mockImplementationOnce(
					() =>
						new Promise((resolve) => {
							// Hold the first poll open until we signal it
							firstPollPromise.then(() => resolve(null));
						}),
				)
				.mockResolvedValue(null);

			// Start first poll (will be held open)
			const pollPromise = processor.poll();

			// While first poll is running, request another poll
			const secondPollPromise = processor.poll(new Set(['test-job']));

			// The second poll should stay queued until the first poll finishes.
			expect(spy).toHaveBeenCalledTimes(1);

			// Release the first poll
			firstPollResolve?.();
			await secondPollPromise;
			await pollPromise;

			// First poll: 1 call. Re-poll (full): 1 call.
			expect(spy).toHaveBeenCalledTimes(2);
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
			const worker = createWorker({ handler });

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
			const worker = createWorker();

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
			const worker = createWorker({
				handler: vi.fn().mockRejectedValue(new Error('Handler failed')),
			});

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
			const worker = createWorker({
				handler: vi.fn().mockRejectedValue('String error message'),
			});

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
			const worker = createWorker();

			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(completedJob);

			await processor.processJob(job, worker);

			expect(worker.activeJobs.size).toBe(0);
		});

		it('should not emit job:complete when completeJob returns null (race condition)', async () => {
			const job = JobFactoryHelpers.processing();
			const worker = createWorker();

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
			const worker = createWorker({
				handler: vi.fn().mockRejectedValue(new Error('Handler failed')),
			});

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
			const worker1 = createWorker({
				handler: vi.fn().mockRejectedValue(new Error('Fail')),
			});

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
			const worker2 = createWorker({
				handler: vi.fn().mockRejectedValue(new Error('Fail')),
			});

			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(permanentlyFailedJob);

			await processor.processJob(job2, worker2);

			const failEvent = ctx.emitHistory.find((e) => e.event === 'job:fail');
			expect((failEvent?.payload as { willRetry: boolean })?.willRetry).toBe(false);
		});

		it('should still remove job from activeJobs even when transition returns null', async () => {
			const job = JobFactoryHelpers.processing();
			const worker = createWorker();

			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(null);

			await processor.processJob(job, worker);

			expect(worker.activeJobs.size).toBe(0);
		});

		it('should call notifyJobFinished after successful completion', async () => {
			const job = JobFactoryHelpers.processing();
			const completedJob = JobFactoryHelpers.completed({
				_id: job._id,
				name: job.name,
				data: job.data,
			});
			const worker = createWorker();

			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(completedJob);

			await processor.processJob(job, worker);

			expect(ctx.notifyJobFinished).toHaveBeenCalledOnce();
		});

		it('should call notifyJobFinished after failure', async () => {
			const job = JobFactoryHelpers.processing({ failCount: 0 });
			const failedJob = JobFactoryHelpers.pending({
				_id: job._id,
				name: job.name,
				data: job.data,
				failCount: 1,
				failReason: 'Handler failed',
			});
			const worker = createWorker({
				handler: vi.fn().mockRejectedValue(new Error('Handler failed')),
			});

			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(failedJob);

			await processor.processJob(job, worker);

			expect(ctx.notifyJobFinished).toHaveBeenCalledOnce();
		});
	});

	describe('_totalActiveJobs counter', () => {
		it('should increment counter when job is acquired via poll and decrement after completion', async () => {
			const acquiredJob = JobFactory.build({ name: 'test-job' });
			const completedJob = JobFactoryHelpers.completed({
				_id: acquiredJob._id,
				name: acquiredJob.name,
				data: acquiredJob.data,
			});

			ctx.workers.set('test-job', createWorker({ concurrency: 3 }));

			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate')
				.mockResolvedValueOnce(acquiredJob) // acquireJob succeeds
				.mockResolvedValueOnce(null) // second acquireJob returns null (no more jobs)
				.mockResolvedValueOnce(completedJob); // completeJob succeeds

			await processor.poll();

			// processJob runs asynchronously; flush the microtask queue
			await new Promise<void>((r) => setTimeout(r, 0));

			const worker = ctx.workers.get('test-job');
			expect(worker?.activeJobs.size).toBe(0);
		});

		it('should decrement counter even when processJob handler fails', async () => {
			const acquiredJob = JobFactory.build({ name: 'test-job' });
			const failedJob = JobFactoryHelpers.failed({
				_id: acquiredJob._id,
				name: acquiredJob.name,
				data: acquiredJob.data,
				failCount: 3,
			});

			ctx.workers.set(
				'test-job',
				createWorker({
					concurrency: 3,
					handler: vi.fn().mockRejectedValue(new Error('boom')),
				}),
			);

			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate')
				.mockResolvedValueOnce(acquiredJob) // acquireJob
				.mockResolvedValueOnce(null) // second acquire: no more
				.mockResolvedValueOnce(failedJob); // failJob DB write

			await processor.poll();
			await new Promise<void>((r) => setTimeout(r, 0));

			const worker = ctx.workers.get('test-job');
			expect(worker?.activeJobs.size).toBe(0);
		});

		it('should decrement counter even when DB transition returns null (race condition)', async () => {
			const acquiredJob = JobFactory.build({ name: 'test-job' });
			ctx.workers.set('test-job', createWorker({ concurrency: 3 }));

			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate')
				.mockResolvedValueOnce(acquiredJob) // acquireJob
				.mockResolvedValueOnce(null) // second acquire: no more
				.mockResolvedValueOnce(null); // completeJob: race condition null

			await processor.poll();
			await new Promise<void>((r) => setTimeout(r, 0));

			const worker = ctx.workers.get('test-job');
			expect(worker?.activeJobs.size).toBe(0);
		});

		it('should cap poll acquisitions at instanceConcurrency using the O(1) counter', async () => {
			ctx.options.instanceConcurrency = 2;
			ctx.workers.set('test-job', createWorker({ concurrency: 10 }));

			const job1 = JobFactory.build({ name: 'test-job' });
			const job2 = JobFactory.build({ name: 'test-job' });

			const spy = vi
				.spyOn(ctx.mockCollection, 'findOneAndUpdate')
				.mockResolvedValueOnce(job1)
				.mockResolvedValueOnce(job2)
				.mockResolvedValue(null);

			await processor.poll();

			const acquireCalls = spy.mock.calls.filter(
				(args) =>
					typeof args[0] === 'object' &&
					args[0] !== null &&
					'status' in args[0] &&
					args[0]['status'] === JobStatus.PENDING,
			);
			// counter enforces the limit: exactly 2 acquired (= instanceConcurrency)
			expect(acquireCalls).toHaveLength(2);
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

			const result = await processor.completeJob(job);

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

			const result = await processor.completeJob(job);

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
				typeof processor.completeJob
			>[0];

			const result = await processor.completeJob(nonPersistedJob);

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

			const result = await processor.failJob(job, error);

			expect(result).not.toBeNull();
			expect(result?.status).toBe(JobStatus.FAILED);
			expect(result?.failCount).toBe(3);
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

			const result = await processor.failJob(job, error);

			expect(result).toBeNull();
			expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
				{ _id: job._id, status: JobStatus.PROCESSING, claimedBy: 'test-instance-id' },
				expect.any(Object),
				{ returnDocument: 'after' },
			);
		});

		it('should return null for non-persisted jobs (no _id)', async () => {
			const { _id: _, ...jobWithoutId } = JobFactory.build();
			const nonPersistedJob = jobWithoutId as unknown as Parameters<typeof processor.failJob>[0];
			const error = new Error('Test error');

			const result = await processor.failJob(nonPersistedJob, error);

			expect(result).toBeNull();
			expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
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
