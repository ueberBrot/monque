import type { Collection, Db, Document, WithId } from 'mongodb';
import { afterEach, beforeEach, describe, expect, it, type Mocked, vi } from 'vitest';

import { JobStatus } from '@/jobs';
import { Monque } from '@/scheduler';

describe('Monque Shutdown Race Condition', () => {
	let db: Mocked<Db>;
	let collection: Mocked<Collection>;
	let monque: Monque;

	beforeEach(() => {
		vi.useFakeTimers();

		// Create a partial mock of the collection
		collection = {
			createIndex: vi.fn(),
			findOneAndUpdate: vi.fn(),
			watch: vi.fn(),
			updateMany: vi.fn(), // Needed for updateHeartbeats / recoverStaleJobs implicitly called
			updateOne: vi.fn(), // Needed for completeJob/failJob
			deleteMany: vi.fn(), // Needed for cleanup
			find: vi.fn(), // Needed for getJobs
			findOne: vi.fn(), // Needed for getJob
			insertOne: vi.fn(), // Needed for enqueue
		} as unknown as Mocked<Collection>;

		db = {
			collection: vi.fn().mockReturnValue(collection),
		} as unknown as Mocked<Db>;

		monque = new Monque(db, {
			pollInterval: 1000,
			defaultConcurrency: 5, // Important: must be > 1 to test loop continuation
		});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('should abort polling loop immediately when stop() is called mid-loop', async () => {
		// Mock updateMany to simulate successful stale job recovery during initialization
		collection.updateMany.mockResolvedValue({
			modifiedCount: 0,
			upsertedId: null,
			upsertedCount: 0,
			matchedCount: 0,
			acknowledged: true,
		});

		await monque.initialize();

		// Register a worker so poll() simulates fetching jobs
		monque.register('test-job', async () => {});

		// Setup a controlled promise to hang on the first findOneAndUpdate call
		let resolveFirstCall: ((value: WithId<Document> | null) => void) | undefined;
		const firstCallPromise = new Promise<WithId<Document> | null>((resolve) => {
			resolveFirstCall = resolve;
		});

		// 1st call hangs (simulating long DB op), subsequent calls return null (to stop poll loop)
		collection.findOneAndUpdate
			.mockReturnValueOnce(firstCallPromise as Promise<WithId<Document>>)
			.mockResolvedValue(null);

		// Start Monque (triggers poll via setInterval)
		monque.start();

		// Advance time to trigger the first poll
		// await vi.advanceTimersByTimeAsync(1000);

		// poller has called acquireJob -> findOneAndUpdate, which is now pending
		expect(collection.findOneAndUpdate).toHaveBeenCalledTimes(1);

		// Trigger stop() while acquisition is pending
		const stopPromise = monque.stop();

		// Resolve the pending acquisition to simulate DB responding during shutdown
		if (resolveFirstCall) {
			resolveFirstCall({
				value: {
					_id: 'job-1',
					name: 'test-job',
					status: JobStatus.PROCESSING,
					data: {},
				},
			} as unknown as WithId<Document>);
		}

		await stopPromise;

		// Verify that loop aborted immediately after first acquisition returned.
		// If race condition existed, loop would have continued and called findOneAndUpdate again.
		expect(collection.findOneAndUpdate).toHaveBeenCalledTimes(1);
	});
});
