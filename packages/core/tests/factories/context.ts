import { fromPartial } from "@total-typescript/shoehorn";
/**
 * Factory for creating mock SchedulerContext and WorkerRegistration for service unit tests.
 *
 * Provides a reusable mock context with vi.fn() stubs for all methods,
 * allowing tests to verify internal service behavior without MongoDB.
 */
import type { Collection } from "mongodb";
import { vi } from "vite-plus/test";

import type { MonqueEventMap } from "@/events";
import { documentToPersistedJob } from "@/jobs";
import type { PersistedJob } from "@/jobs";
import type { ResolvedMonqueOptions, SchedulerContext } from "@/scheduler/services/types.js";
import { WorkerAdmissionState } from "@/scheduler/services/worker-admission.js";
import { definedProperty } from "@/shared/utils/defined-property.js";
import type { WorkerRegistration } from "@/workers";
import type { MockFunction } from "@tests/setup/mock-function.js";

/**
 * Create a mock MongoDB collection with vi.fn() stubs.
 */
const createMockCollection = () => ({
  insertOne: vi.fn<MockFunction<Collection["insertOne"]>>(),
  insertMany: vi.fn<MockFunction<Collection["insertMany"]>>(),
  bulkWrite: vi.fn<MockFunction<Collection["bulkWrite"]>>(),
  findOne: vi.fn<MockFunction<Collection["findOne"]>>(),
  find: vi.fn<MockFunction<Collection["find"]>>(),
  findOneAndUpdate: vi.fn<MockFunction<Collection["findOneAndUpdate"]>>(),
  updateOne: vi.fn<MockFunction<Collection["updateOne"]>>(),
  updateMany: vi.fn<MockFunction<Collection["updateMany"]>>(),
  deleteOne: vi.fn<MockFunction<Collection["deleteOne"]>>(),
  deleteMany: vi.fn<MockFunction<Collection["deleteMany"]>>(),
  countDocuments: vi.fn<MockFunction<Collection["countDocuments"]>>(),
  options: vi.fn<MockFunction<Collection["options"]>>().mockResolvedValue({}),
  aggregate: vi.fn<MockFunction<Collection["aggregate"]>>(),
  watch: vi.fn<MockFunction<Collection["watch"]>>(),
  createIndexes: vi.fn<MockFunction<Collection["createIndexes"]>>(),
});

/**
 * Default resolved options for tests.
 */
const DEFAULT_TEST_OPTIONS: ResolvedMonqueOptions = {
  collectionName: "test_jobs",
  pollInterval: 1000,
  safetyPollInterval: 30_000,
  maxRetries: 3,
  baseRetryInterval: 100,
  shutdownTimeout: 5000,
  workerConcurrency: 5,
  lockTimeout: 30_000,
  recoverStaleJobs: true,
  schedulerInstanceId: "test-instance-id",
  heartbeatInterval: 1000,
  maxBackoffDelay: undefined,
  jobRetention: undefined,
  instanceConcurrency: undefined,
  skipIndexCreation: false,
  maxPayloadSize: undefined,
  statsCacheTtlMs: 5000,
};

/**
 * Create a mock SchedulerContext for testing internal services.
 *
 * @example
 * ```typescript
 * const ctx = createMockContext();
 * const intake = makeNativeJobIntake(ctx);
 *
 * // Mock collection responses using vi.spyOn and JobFactory
 * vi.spyOn(ctx.mockCollection, 'findOne').mockResolvedValueOnce(JobFactory.build());
 *
 * // Assert on emitted events
 * expect(ctx.emitHistory).toContainEqual({ event: 'job:cancelled', payload: ... });
 * ```
 */
export const createMockContext = (overrides: Partial<SchedulerContext> = {}) => {
  const mockCollection = createMockCollection();

  const emitHistory: {
    event: string;
    payload: unknown;
  }[] = [];

  const options = overrides.options ?? { ...DEFAULT_TEST_OPTIONS };
  const admission = overrides.admission ?? new WorkerAdmissionState(options);
  admission.start();

  const registerWorker = (name: string, worker: WorkerRegistration) => {
    const { activeJobs } = worker;
    admission.register(name, worker.handler, {
      concurrency: worker.concurrency,
      ...worker.retryOptions,
      ...definedProperty(worker, "schema"),
      replace: true,
    });

    for (const job of activeJobs.values()) {
      admission.beginExecution(name, job);
    }

    // Existing fixture references observe the owner's current execution records.
    Object.defineProperty(worker, "activeJobs", {
      get: () => admission.workers.get(name)?.activeJobs ?? new Map(),
      configurable: true,
    });
  };

  const ctx = {
    collection: fromPartial<Collection>(mockCollection),
    options,
    instanceId: "test-instance-id",
    admission,
    registerWorker,
    get workers() {
      return admission.workers;
    },

    documentToPersistedJob,
    ...overrides,
    isRunning: vi.fn<MockFunction<SchedulerContext["isRunning"]>>(
      overrides.isRunning ?? (() => true),
    ),
    isPaused: vi.fn<MockFunction<SchedulerContext["isPaused"]>>(
      overrides.isPaused ?? (() => false),
    ),
    emit: vi.fn<MockFunction<SchedulerContext["emit"]>>(
      overrides.emit ??
        (<K extends keyof MonqueEventMap>(event: K, payload: MonqueEventMap[K]) => {
          emitHistory.push({ event, payload });

          return true;
        }),
    ),
    notifyPendingJob: vi.fn<MockFunction<SchedulerContext["notifyPendingJob"]>>(
      overrides.notifyPendingJob,
    ),
    notifyJobFinished: vi.fn<MockFunction<SchedulerContext["notifyJobFinished"]>>(
      overrides.notifyJobFinished,
    ),
  };

  return Object.assign(ctx, { mockCollection, emitHistory });
};

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
export const createWorker = (overrides: Partial<WorkerRegistration> = {}): WorkerRegistration => ({
  handler:
    overrides.handler ??
    vi.fn<MockFunction<WorkerRegistration["handler"]>>().mockResolvedValue(undefined),
  concurrency: overrides.concurrency ?? 1,
  ...definedProperty(overrides, "schema"),
  ...definedProperty(overrides, "retryOptions"),
  activeJobs: overrides.activeJobs ?? new Map<string, PersistedJob>(),
});
