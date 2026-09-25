/**
 * Unit tests for Monque class.
 *
 * Tests top-level initialization, state management, and orchestration.
 * Internal services are tested in their respective unit tests.
 */

import { type Collection, type Db, ObjectId } from 'mongodb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Monque } from '@/scheduler/monque.js';
import { ConnectionError, InvalidJobIdentifierError, WorkerRegistrationError } from '@/shared';

// Mock the services to avoid instantiating them
vi.mock('@/scheduler/services/index.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/scheduler/services/index.js')>();
	return {
		...actual,
		JobIntake: vi.fn(),
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

	describe('constructor', () => {
		it('should set maxListeners to 20', () => {
			expect(monque.getMaxListeners()).toBe(20);
		});
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
			// Queue View summaries
			await expect(monque.getQueueViewSummaries()).rejects.toThrow(ConnectionError);
			// Management
			await expect(monque.cancelJob('123')).rejects.toThrow(ConnectionError);
		});

		it('should throw ConnectionError when accessing internal services', () => {
			// Accessing private getters via casting to unknown (simulating internal usage or bugs)
			expect(() => (monque as unknown as Record<string, unknown>)['intake']).toThrow(
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
		it('should throw WorkerRegistrationError on duplicate registration', () => {
			const handler = async () => {};
			monque.register('test-job', handler);

			expect(() => {
				monque.register('test-job', handler);
			}).toThrow(WorkerRegistrationError);
		});

		it('passes the replacement handler and concurrency to the processor', async () => {
			const handler1 = async () => {};
			const handler2 = async () => {};

			monque.register('test-job', handler1);
			monque.register('test-job', handler2, { replace: true, concurrency: 3 });
			await monque.initialize();

			const { JobProcessor } = await import('@/scheduler/services');
			const context = vi.mocked(JobProcessor).mock.calls[0]?.[0];
			expect(context?.workers.get('test-job')).toMatchObject({
				handler: handler2,
				concurrency: 3,
			});
		});

		it('should reject invalid worker names', () => {
			const handler = async () => {};

			expect(() => {
				monque.register('invalid worker', handler);
			}).toThrow(InvalidJobIdentifierError);

			expect(() => {
				monque.register('\u0000', handler);
			}).toThrow(InvalidJobIdentifierError);
		});
	});

	describe('delegation', () => {
		beforeEach(async () => {
			await monque.initialize();
			Object.defineProperty(monque, '_query', {
				value: { clearStatsCache: vi.fn() },
				configurable: true,
				writable: true,
			});
		});

		it('should reject invalid enqueue job names before delegating', async () => {
			const spy = vi.fn();
			(monque as unknown as Record<string, unknown>)['_intake'] = { enqueue: spy };

			await expect(monque.enqueue('invalid job', { foo: 'bar' })).rejects.toThrow(
				InvalidJobIdentifierError,
			);
			expect(spy).not.toHaveBeenCalled();
		});

		it('should reject invalid enqueue unique keys before delegating', async () => {
			const spy = vi.fn();
			(monque as unknown as Record<string, unknown>)['_intake'] = { enqueue: spy };

			await expect(
				monque.enqueue('valid-job', { foo: 'bar' }, { uniqueKey: '   ' }),
			).rejects.toThrow(InvalidJobIdentifierError);
			expect(spy).not.toHaveBeenCalled();
		});

		it('should reject invalid scheduled job names before delegating', async () => {
			const spy = vi.fn();
			(monque as unknown as Record<string, unknown>)['_intake'] = { schedule: spy };

			await expect(monque.schedule('* * * * *', 'bad name', {})).rejects.toThrow(
				InvalidJobIdentifierError,
			);
			expect(spy).not.toHaveBeenCalled();
		});

		it('converts Management string IDs before querying MongoDB', async () => {
			const job = { _id: new ObjectId(), name: 'test-job' };
			const getJob = vi.fn().mockResolvedValue(job);
			Object.defineProperty(monque, '_query', { value: { getJob }, configurable: true });

			expect(await monque.getJob(job._id.toHexString())).toBe(job);
			expect(getJob).toHaveBeenCalledWith(job._id);
		});

		it('returns null for invalid string IDs without querying MongoDB', async () => {
			const getJob = vi.fn();
			Object.defineProperty(monque, '_query', { value: { getJob }, configurable: true });

			expect(await monque.getJob('invalid-id')).toBeNull();
			expect(getJob).not.toHaveBeenCalled();
		});
	});
});
