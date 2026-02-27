/**
 * Factory for creating mock SchedulerContext and WorkerRegistration for service unit tests.
 *
 * Provides a reusable mock context with vi.fn() stubs for all methods,
 * allowing tests to verify internal service behavior without MongoDB.
 */

import type { Collection, Document } from 'mongodb';
import { vi } from 'vitest';

import type { MonqueEventMap } from '@/events';
import { documentToPersistedJob, type JobHandler, type PersistedJob } from '@/jobs';
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
	skipIndexCreation: false,
	maxPayloadSize: undefined,
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
		createIndexes: vi.fn(),
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
		documentToPersistedJob: documentToPersistedJob,
		...overrides,
	};

	return { ...ctx, mockCollection, emitHistory };
}

/**
 * Create a mock WorkerRegistration for testing.
 *
 * @example
 * ```typescript
 * // Default: resolving handler, concurrency 1, no active jobs
 * const worker = createWorker();
 *
 * // Custom handler and concurrency
 * const worker = createWorker({ handler: vi.fn().mockRejectedValue(new Error('fail')), concurrency: 5 });
 *
 * // Pre-populate active jobs
 * const worker = createWorker({ activeJobs: new Map([['id', job]]) });
 * ```
 */
export function createWorker(overrides: Partial<WorkerRegistration> = {}): WorkerRegistration {
	return {
		handler: (overrides.handler as JobHandler) ?? vi.fn().mockResolvedValue(undefined),
		concurrency: overrides.concurrency ?? 1,
		activeJobs: overrides.activeJobs ?? new Map<string, PersistedJob>(),
	};
}
