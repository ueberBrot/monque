/**
 * Factory for creating mock SchedulerContext for service unit tests.
 *
 * Provides a reusable mock context with vi.fn() stubs for all methods,
 * allowing tests to verify internal service behavior without MongoDB.
 */

import type { Collection, Document, WithId } from 'mongodb';
import { vi } from 'vitest';

import type { MonqueEventMap } from '@/events';
import type { JobStatusType, PersistedJob } from '@/jobs';
import type { ResolvedMonqueOptions, SchedulerContext } from '@/scheduler/services/types.js';
import type { WorkerRegistration } from '@/workers';

/**
 * Default resolved options for tests.
 */
const DEFAULT_TEST_OPTIONS: ResolvedMonqueOptions = {
	collectionName: 'test_jobs',
	pollInterval: 1000,
	maxRetries: 3,
	baseRetryInterval: 100,
	shutdownTimeout: 5000,
	workerConcurrency: 5,
	lockTimeout: 30000,
	recoverStaleJobs: true,
	schedulerInstanceId: 'test-instance-id',
	heartbeatInterval: 1000,
	maxBackoffDelay: undefined,
	jobRetention: undefined,
	instanceConcurrency: undefined,
};

/**
 * Create a mock MongoDB collection with vi.fn() stubs.
 */
function createMockCollection(): Collection<Document> {
	return {
		insertOne: vi.fn(),
		insertMany: vi.fn(),
		findOne: vi.fn(),
		find: vi.fn(),
		findOneAndUpdate: vi.fn(),
		updateOne: vi.fn(),
		updateMany: vi.fn(),
		deleteOne: vi.fn(),
		deleteMany: vi.fn(),
		countDocuments: vi.fn(),
		aggregate: vi.fn(),
		watch: vi.fn(),
		createIndex: vi.fn(),
	} as unknown as Collection<Document>;
}

/**
 * Create a mock SchedulerContext for testing internal services.
 *
 * @example
 * ```typescript
 * const ctx = createMockContext();
 * const scheduler = new JobScheduler(ctx);
 *
 * // Mock collection responses using vi.spyOn and JobFactory
 * vi.spyOn(ctx.mockCollection, 'findOne').mockResolvedValueOnce(JobFactory.build());
 *
 * // Assert on emitted events
 * expect(ctx.emitHistory).toContainEqual({ event: 'job:cancelled', payload: ... });
 * ```
 */
export function createMockContext(overrides: Partial<SchedulerContext> = {}): SchedulerContext & {
	mockCollection: Collection<Document>;
	emitHistory: Array<{ event: string; payload: unknown }>;
} {
	const mockCollection = createMockCollection();
	const emitHistory: Array<{ event: string; payload: unknown }> = [];
	const workers = new Map<string, WorkerRegistration>();

	const ctx: SchedulerContext = {
		collection: mockCollection,
		options: { ...DEFAULT_TEST_OPTIONS },
		instanceId: 'test-instance-id',
		workers,
		isRunning: vi.fn(() => true),
		emit: vi.fn(<K extends keyof MonqueEventMap>(event: K, payload: MonqueEventMap[K]) => {
			emitHistory.push({ event, payload });
			return true;
		}),
		documentToPersistedJob: <T>(doc: WithId<Document>): PersistedJob<T> => {
			return {
				_id: doc._id,
				name: doc['name'] as string,
				data: doc['data'] as T,
				status: doc['status'] as JobStatusType,
				nextRunAt: doc['nextRunAt'] as Date,
				failCount: doc['failCount'] as number,
				createdAt: doc['createdAt'] as Date,
				updatedAt: doc['updatedAt'] as Date,
				...(doc['uniqueKey'] && { uniqueKey: doc['uniqueKey'] as string }),
				...(doc['repeatInterval'] && { repeatInterval: doc['repeatInterval'] as string }),
				...(doc['lockedAt'] && { lockedAt: doc['lockedAt'] as Date }),
				...(doc['claimedBy'] && { claimedBy: doc['claimedBy'] as string }),
				...(doc['failReason'] && { failReason: doc['failReason'] as string }),
			};
		},
		...overrides,
	};

	return { ...ctx, mockCollection, emitHistory };
}
