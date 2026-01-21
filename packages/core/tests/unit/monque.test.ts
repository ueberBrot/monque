/**
 * Unit tests for Monque class.
 *
 * Tests top-level initialization, state management, and orchestration.
 * Internal services are tested in their respective unit tests.
 */

import type { Collection, Db, ObjectId } from 'mongodb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Monque } from '@/scheduler/monque.js';
import { ConnectionError, WorkerRegistrationError } from '@/shared';

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
	};
});

describe('Monque', () => {
	let mockDb: Db;
	let mockCollection: Collection;
	let monque: Monque;

	beforeEach(() => {
		mockCollection = {
			createIndex: vi.fn().mockResolvedValue('index_name'),
			updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
			deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }),
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
			expect(mockCollection.createIndex).toHaveBeenCalled();
		});

		it('should be idempotent (multiple calls do nothing)', async () => {
			await monque.initialize();
			// Clear mocks to verify second call triggers nothing
			vi.clearAllMocks();

			await monque.initialize();

			expect(mockDb.collection).not.toHaveBeenCalled();
			expect(mockCollection.createIndex).not.toHaveBeenCalled();
		});

		it('should throw ConnectionError if initialization fails', async () => {
			vi.mocked(mockDb.collection).mockImplementationOnce(() => {
				throw new Error('DB Connection Failed');
			});

			await expect(monque.initialize()).rejects.toThrow(ConnectionError);
		});
	});

	describe('uninitialized state', () => {
		it('should throw ConnectionError when calling public methods before initialize', async () => {
			// Enqueue
			await expect(monque.enqueue('test', {})).rejects.toThrow(ConnectionError);
			// Schedule
			await expect(monque.schedule('* * * * *', 'test', {})).rejects.toThrow(ConnectionError);
			// Get
			await expect(monque.getJob(new Object() as unknown as ObjectId)).rejects.toThrow(
				ConnectionError,
			);
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
});
