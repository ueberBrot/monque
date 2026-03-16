/**
 * Unit tests for Monque class.
 *
 * Tests top-level initialization, state management, and orchestration.
 * Internal services are tested in their respective unit tests.
 */

import { type Collection, type Db, ObjectId } from 'mongodb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PersistedJob } from '@/jobs';
import { Monque } from '@/scheduler/monque.js';
import { ConnectionError, ShutdownTimeoutError, WorkerRegistrationError } from '@/shared';
import type { WorkerRegistration } from '@/workers';

// Mock the services to avoid instantiating them
vi.mock('@/scheduler/services/index.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/scheduler/services/index.js')>();
	return {
		...actual,
		JobScheduler: vi.fn(),
		JobManager: vi.fn(),
		JobQueryService: vi.fn(),
		JobProcessor: vi.fn(),
		ChangeStreamHandler: vi.fn(),
		LifecycleManager: vi.fn(),
	};
});

describe('Monque', () => {
	let mockDb: Db;
	let mockCollection: Collection;
	let monque: Monque;

	beforeEach(() => {
		mockCollection = {
			createIndexes: vi.fn().mockResolvedValue(['index_name']),
			updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
			deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }),
			findOne: vi.fn().mockResolvedValue(null),
		} as unknown as Collection;

		mockDb = {
			collection: vi.fn().mockReturnValue(mockCollection),
		} as unknown as Db;

		monque = new Monque(mockDb);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('initialize', () => {
		it('should initialize successfully', async () => {
			await monque.initialize();

			expect(mockDb.collection).toHaveBeenCalledWith('monque_jobs');
			expect(mockCollection.createIndexes).toHaveBeenCalledOnce();
		});

		it('should be idempotent (multiple calls do nothing)', async () => {
			await monque.initialize();
			// Clear mocks to verify second call triggers nothing
			vi.clearAllMocks();

			await monque.initialize();

			expect(mockDb.collection).not.toHaveBeenCalled();
			expect(mockCollection.createIndexes).not.toHaveBeenCalled();
		});

		it('should throw ConnectionError if initialization fails', async () => {
			vi.spyOn(mockDb, 'collection').mockImplementationOnce(() => {
				throw new Error('DB Connection Failed');
			});

			await expect(monque.initialize()).rejects.toThrow(ConnectionError);
		});

		it('should skip index creation when skipIndexCreation is true', async () => {
			const skipMonque = new Monque(mockDb, { skipIndexCreation: true });
			await skipMonque.initialize();

			expect(mockDb.collection).toHaveBeenCalledWith('monque_jobs');
			expect(mockCollection.createIndexes).not.toHaveBeenCalled();
		});

		it('should create compound index for job retention when configured', async () => {
			const retentionMonque = new Monque(mockDb, { jobRetention: { completed: 10000 } });
			await retentionMonque.initialize();

			const calls = vi.mocked(mockCollection.createIndexes).mock.calls;
			expect(calls[0]?.[0]).toContainEqual(
				expect.objectContaining({
					key: { status: 1, updatedAt: 1 },
					background: true,
					partialFilterExpression: expect.objectContaining({
						updatedAt: { $exists: true },
						status: { $in: expect.arrayContaining(['completed', 'failed']) },
					}),
				}),
			);
		});

		it('should not create index for job retention when omitted', async () => {
			const MonqueInstance = new Monque(mockDb, {});
			await MonqueInstance.initialize();

			const calls = vi.mocked(mockCollection.createIndexes).mock.calls;
			expect(calls[0]?.[0]).not.toContainEqual(
				expect.objectContaining({
					key: { status: 1, updatedAt: 1 },
				}),
			);
		});
	});

	describe('uninitialized state', () => {
		it('should throw ConnectionError when calling public methods before initialize', async () => {
			// Enqueue
			await expect(monque.enqueue('test', {})).rejects.toThrow(ConnectionError);
			// Schedule
			await expect(monque.schedule('* * * * *', 'test', {})).rejects.toThrow(ConnectionError);
			// Get
			await expect(monque.getJob(new ObjectId())).rejects.toThrow(ConnectionError);
			// Management
			await expect(monque.cancelJob('123')).rejects.toThrow(ConnectionError);
		});

		it('should throw ConnectionError when accessing internal services', () => {
			// Accessing private getters via casting to unknown (simulating internal usage or bugs)
			expect(() => (monque as unknown as Record<string, unknown>)['scheduler']).toThrow(
				ConnectionError,
			);
			expect(() => (monque as unknown as Record<string, unknown>)['manager']).toThrow(
				ConnectionError,
			);
			expect(() => (monque as unknown as Record<string, unknown>)['query']).toThrow(
				ConnectionError,
			);
			expect(() => (monque as unknown as Record<string, unknown>)['processor']).toThrow(
				ConnectionError,
			);
			expect(() => (monque as unknown as Record<string, unknown>)['changeStreamHandler']).toThrow(
				ConnectionError,
			);
			expect(() => (monque as unknown as Record<string, unknown>)['lifecycleManager']).toThrow(
				ConnectionError,
			);
		});
	});

	describe('worker registration', () => {
		it('should register a worker', () => {
			const handler = async () => {};
			monque.register('test-job', handler);

			// We can't easily inspect private map, but we verify it doesn't throw
		});

		it('should throw WorkerRegistrationError on duplicate registration', () => {
			const handler = async () => {};
			monque.register('test-job', handler);

			expect(() => {
				monque.register('test-job', handler);
			}).toThrow(WorkerRegistrationError);
		});

		it('should allow replacing worker with { replace: true }', () => {
			const handler1 = async () => {};
			const handler2 = async () => {};

			monque.register('test-job', handler1);

			expect(() => {
				monque.register('test-job', handler2, { replace: true });
			}).not.toThrow();
		});
	});

	describe('delegation', () => {
		beforeEach(async () => {
			await monque.initialize();
		});

		it('should delegate enqueue to scheduler', async () => {
			const spy = vi.fn();
			(monque as unknown as Record<string, unknown>)['_scheduler'] = { enqueue: spy };

			await monque.enqueue('test', { foo: 'bar' });
			expect(spy).toHaveBeenCalledWith('test', { foo: 'bar' }, {});
		});

		it('should delegate now to scheduler', async () => {
			const spy = vi.fn();
			(monque as unknown as Record<string, unknown>)['_scheduler'] = { now: spy };

			await monque.now('test', { foo: 'bar' });
			expect(spy).toHaveBeenCalledWith('test', { foo: 'bar' });
		});

		it('should delegate schedule to scheduler', async () => {
			const spy = vi.fn();
			(monque as unknown as Record<string, unknown>)['_scheduler'] = { schedule: spy };

			await monque.schedule('* * * * *', 'test', {});
			expect(spy).toHaveBeenCalledWith('* * * * *', 'test', {}, {});
		});

		it('should delegate getJob to query service', async () => {
			const spy = vi.fn();
			(monque as unknown as Record<string, unknown>)['_query'] = { getJob: spy };

			const id = new Object();
			await monque.getJob(id as unknown as ObjectId);
			expect(spy).toHaveBeenCalledWith(id);
		});

		it('should delegate getJobs to query service', async () => {
			const spy = vi.fn();
			(monque as unknown as Record<string, unknown>)['_query'] = { getJobs: spy };

			await monque.getJobs({ limit: 10 });
			expect(spy).toHaveBeenCalledWith({ limit: 10 });
		});

		it('should delegate getQueueStats to query service', async () => {
			const spy = vi.fn();
			(monque as unknown as Record<string, unknown>)['_query'] = { getQueueStats: spy };

			await monque.getQueueStats();
			expect(spy).toHaveBeenCalledWith(undefined);
		});

		it('should delegate cancelJob to manager', async () => {
			const spy = vi.fn();
			(monque as unknown as Record<string, unknown>)['_manager'] = { cancelJob: spy };

			await monque.cancelJob('123');
			expect(spy).toHaveBeenCalledWith('123');
		});

		it('should delegate retryJob to manager', async () => {
			const spy = vi.fn();
			(monque as unknown as Record<string, unknown>)['_manager'] = { retryJob: spy };

			await monque.retryJob('123');
			expect(spy).toHaveBeenCalledWith('123');
		});

		it('should delegate deleteJob to manager', async () => {
			const spy = vi.fn();
			(monque as unknown as Record<string, unknown>)['_manager'] = { deleteJob: spy };

			await monque.deleteJob('123');
			expect(spy).toHaveBeenCalledWith('123');
		});
	});

	describe('stop', () => {
		/**
		 * Helper to access private workers Map and simulate active jobs.
		 */
		function getWorkers(m: Monque): Map<string, WorkerRegistration> {
			return (m as unknown as { workers: Map<string, WorkerRegistration> }).workers;
		}

		function setRunning(m: Monque, running: boolean): void {
			(m as unknown as Record<string, boolean>)['isRunning'] = running;
		}

		beforeEach(async () => {
			await monque.initialize();

			// Stub lifecycle & change stream to avoid real timer/stream logic
			(monque as unknown as Record<string, unknown>)['_lifecycleManager'] = {
				startTimers: vi.fn(),
				stopTimers: vi.fn(),
			};
			(monque as unknown as Record<string, unknown>)['_changeStreamHandler'] = {
				setup: vi.fn(),
				close: vi.fn().mockResolvedValue(undefined),
				isActive: vi.fn().mockReturnValue(false),
			};
			(monque as unknown as Record<string, unknown>)['_query'] = {
				clearStatsCache: vi.fn(),
			};
		});

		it('should return immediately when no active jobs (getActiveJobCount === 0)', async () => {
			setRunning(monque, true);

			await monque.stop();

			// Should complete without timeout
			expect((monque as unknown as Record<string, boolean>)['isRunning']).toBe(false);
		});

		it('should count active jobs across multiple workers', async () => {
			setRunning(monque, true);

			const workers = getWorkers(monque);
			const fakeJob = { _id: new ObjectId() } as unknown as PersistedJob;

			// Register two workers with active jobs
			workers.set('worker-a', {
				handler: vi.fn(),
				concurrency: 5,
				activeJobs: new Map([
					['job-1', fakeJob],
					['job-2', fakeJob],
				]),
			});
			workers.set('worker-b', {
				handler: vi.fn(),
				concurrency: 5,
				activeJobs: new Map([['job-3', fakeJob]]),
			});

			// Schedule clearing all active jobs after a short delay
			setTimeout(() => {
				for (const worker of workers.values()) {
					worker.activeJobs.clear();
				}
				// Simulate the job processor triggering the drain resolve
				(monque as unknown as { onJobFinished: () => void }).onJobFinished();
			}, 50);

			await monque.stop();

			// Should have waited for jobs to drain and completed
			expect((monque as unknown as Record<string, boolean>)['isRunning']).toBe(false);
		});

		it('should emit ShutdownTimeoutError with incomplete jobs on timeout', async () => {
			const shortTimeoutMonque = new Monque(mockDb, { shutdownTimeout: 100 });
			await shortTimeoutMonque.initialize();

			// Stub services
			(shortTimeoutMonque as unknown as Record<string, unknown>)['_lifecycleManager'] = {
				startTimers: vi.fn(),
				stopTimers: vi.fn(),
			};
			(shortTimeoutMonque as unknown as Record<string, unknown>)['_changeStreamHandler'] = {
				setup: vi.fn(),
				close: vi.fn().mockResolvedValue(undefined),
				isActive: vi.fn().mockReturnValue(false),
			};
			(shortTimeoutMonque as unknown as Record<string, unknown>)['_query'] = {
				clearStatsCache: vi.fn(),
			};

			setRunning(shortTimeoutMonque, true);

			const fakeJob = {
				_id: new ObjectId(),
				name: 'stuck-job',
				status: 'processing',
			} as unknown as PersistedJob;

			const workers = getWorkers(shortTimeoutMonque);
			workers.set('worker-a', {
				handler: vi.fn(),
				concurrency: 5,
				activeJobs: new Map([['stuck-1', fakeJob]]),
			});

			const errorPromise = new Promise<ShutdownTimeoutError>((resolve) => {
				shortTimeoutMonque.on('job:error', ({ error }) => {
					resolve(error as ShutdownTimeoutError);
				});
			});

			await shortTimeoutMonque.stop();

			const error = await errorPromise;
			expect(error).toBeInstanceOf(ShutdownTimeoutError);
			expect(error.message).toContain('1 incomplete jobs');
		});
	});
});
