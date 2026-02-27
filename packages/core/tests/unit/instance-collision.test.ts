/**
 * Unit tests for instance collision detection in Monque.initialize().
 *
 * Verifies that `checkInstanceCollision()` correctly detects active instances
 * using the same schedulerInstanceId via heartbeat staleness discrimination.
 */

import type { Collection, Db } from 'mongodb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Monque } from '@/scheduler/monque.js';
import { ConnectionError } from '@/shared';

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

describe('Instance Collision Detection', () => {
	let mockDb: Db;
	let mockCollection: Collection;
	let findOneSpy: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		findOneSpy = vi.fn().mockResolvedValue(null);

		mockCollection = {
			createIndexes: vi.fn().mockResolvedValue(['index_name']),
			updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
			findOne: findOneSpy,
		} as unknown as Collection;

		mockDb = {
			collection: vi.fn().mockReturnValue(mockCollection),
		} as unknown as Db;
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('throws ConnectionError when active instance with same ID exists', async () => {
		const instanceId = 'shared-instance-id';
		const monque = new Monque(mockDb, { schedulerInstanceId: instanceId });

		// Simulate an active job with recent heartbeat claimed by same instance
		findOneSpy.mockResolvedValue({
			name: 'some-job',
			lastHeartbeat: new Date(),
			claimedBy: instanceId,
			status: 'processing',
		});

		await expect(monque.initialize()).rejects.toThrow(ConnectionError);
		await expect(monque.initialize()).rejects.toThrow(/schedulerInstanceId/);
	});

	it('includes instance ID and job name in error message', async () => {
		const instanceId = 'collision-id';
		const monque = new Monque(mockDb, { schedulerInstanceId: instanceId });

		findOneSpy.mockResolvedValue({
			name: 'email-sender',
			lastHeartbeat: new Date(),
			claimedBy: instanceId,
			status: 'processing',
		});

		await expect(monque.initialize()).rejects.toThrow(/collision-id/);
		await expect(monque.initialize()).rejects.toThrow(/email-sender/);
	});

	it('does not throw when no active instance exists', async () => {
		const monque = new Monque(mockDb, { schedulerInstanceId: 'unique-id' });

		// findOne returns null (no matching active jobs)
		findOneSpy.mockResolvedValue(null);

		await expect(monque.initialize()).resolves.toBeUndefined();
	});

	it('queries with correct filter shape including heartbeat threshold', async () => {
		const heartbeatInterval = 5000;
		const instanceId = 'check-query-id';
		const monque = new Monque(mockDb, {
			schedulerInstanceId: instanceId,
			heartbeatInterval,
		});

		findOneSpy.mockResolvedValue(null);

		await monque.initialize();

		// Verify findOne was called with the collision detection query
		expect(findOneSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				claimedBy: instanceId,
				status: 'processing',
				lastHeartbeat: expect.objectContaining({
					$gte: expect.any(Date),
				}),
			}),
		);

		// Verify the threshold is approximately 2× heartbeatInterval ago
		const callArgs = findOneSpy.mock.calls[0] as [Record<string, unknown>];
		const query = callArgs[0];
		const lastHeartbeat = query['lastHeartbeat'] as { $gte: Date };
		const threshold = lastHeartbeat.$gte;
		const expectedThreshold = Date.now() - heartbeatInterval * 2;

		// Allow 1 second tolerance for test execution time
		expect(threshold.getTime()).toBeGreaterThan(expectedThreshold - 1000);
		expect(threshold.getTime()).toBeLessThanOrEqual(expectedThreshold + 1000);
	});

	it('does not throw when heartbeat is stale (crash recovery scenario)', async () => {
		const instanceId = 'crashed-instance';
		const monque = new Monque(mockDb, {
			schedulerInstanceId: instanceId,
			heartbeatInterval: 1000,
		});

		// findOne returns null because MongoDB $gte filter excludes stale heartbeats
		// (stale heartbeats are older than 2× heartbeatInterval)
		findOneSpy.mockResolvedValue(null);

		await expect(monque.initialize()).resolves.toBeUndefined();
	});

	it('skips collision check when collection is not initialized', async () => {
		// Create a Monque where collection setup throws before collision check
		const failingDb = {
			collection: vi.fn().mockImplementation(() => {
				throw new Error('DB unavailable');
			}),
		} as unknown as Db;

		const monque = new Monque(failingDb, { schedulerInstanceId: 'test-id' });

		// Should throw ConnectionError from the DB failure, not from collision check
		await expect(monque.initialize()).rejects.toThrow(ConnectionError);
		// findOne should never have been called
		expect(findOneSpy).not.toHaveBeenCalled();
	});

	it('runs collision check after stale recovery', async () => {
		const instanceId = 'order-check-id';
		const monque = new Monque(mockDb, {
			schedulerInstanceId: instanceId,
			recoverStaleJobs: true,
		});

		const callOrder: string[] = [];

		(mockCollection.updateMany as ReturnType<typeof vi.fn>).mockImplementation(async () => {
			callOrder.push('updateMany');
			return { modifiedCount: 0 };
		});

		findOneSpy.mockImplementation(async () => {
			callOrder.push('findOne');
			return null;
		});

		await monque.initialize();

		// updateMany (stale recovery) should be called before findOne (collision check)
		expect(callOrder).toEqual(['updateMany', 'findOne']);
	});

	it('default randomUUID instances never collide with each other', async () => {
		// Two Monque instances with default (random) IDs should not collide
		const monque1 = new Monque(mockDb);
		const monque2 = new Monque(mockDb);

		findOneSpy.mockResolvedValue(null);

		await expect(monque1.initialize()).resolves.toBeUndefined();

		// Reset isInitialized flag by creating fresh instance
		// (monque2 is a separate instance with its own random ID)
		// The key point: findOne returns null because different UUIDs won't match
		await expect(monque2.initialize()).resolves.toBeUndefined();
	});
});
