/**
 * Unit tests for Monque class.
 *
 * Tests initialization and public operations with the real internal modules.
 */
import { EventEmitter } from "node:events";
import { fromPartial } from "@total-typescript/shoehorn";
import { Clock, Effect } from "effect";
import type { ChangeStream, FindCursor, Collection, Db } from "mongodb";
import { MongoServerError, ObjectId } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { MonqueEventMap } from "@/events";
import type { BulkOperationResult, JobHandler } from "@/jobs";
import { Monque } from "@/scheduler/monque.js";
import type { MonqueOptions } from "@/scheduler/types.js";
import {
  ConnectionError,
  InvalidJobIdentifierError,
  MonqueError,
  ShutdownTimeoutError,
  WorkerRegistrationError,
} from "@/shared";
import { JobFactoryHelpers } from "@tests/factories";
import {
  anyMatcher,
  objectContainingMatcher,
  arrayContainingMatcher,
} from "@tests/setup/matchers.js";
import type { MockFunction, NativeMock } from "@tests/setup/mock-function.js";

const readMonotonicNanos = (): bigint => BigInt(Math.round(performance.now() * 1_000_000));

const createStream = (closing = Promise.resolve()) =>
  // oxlint-disable-next-line unicorn/prefer-event-target -- MongoDB cursors use Node EventEmitter delivery and error-listener semantics.
  Object.assign(new EventEmitter(), {
    close: vi.fn<MockFunction<ChangeStream["close"]>>(async () => {
      await closing;
    }),
  });

describe(Monque, () => {
  let mockDb: NativeMock<Db>;
  let mockCollection: NativeMock<Collection>;
  let monque: Monque;
  beforeEach(() => {
    mockCollection = fromPartial<NativeMock<Collection>>({
      createIndexes: vi
        .fn<MockFunction<Collection["createIndexes"]>>()
        .mockResolvedValue(["index_name"]),
      updateMany: vi.fn<MockFunction<Collection["updateMany"]>>().mockResolvedValue({
        acknowledged: true,
        matchedCount: 0,
        modifiedCount: 0,
        upsertedCount: 0,
        upsertedId: null,
      }),
      deleteOne: vi
        .fn<MockFunction<Collection["deleteOne"]>>()
        .mockResolvedValue({ acknowledged: true, deletedCount: 0 }),
      deleteMany: vi
        .fn<MockFunction<Collection["deleteMany"]>>()
        .mockResolvedValue({ acknowledged: true, deletedCount: 0 }),
      findOne: vi.fn<MockFunction<Collection["findOne"]>>().mockResolvedValue(null),
      insertOne: vi
        .fn<MockFunction<Collection["insertOne"]>>()
        .mockResolvedValue({ acknowledged: true, insertedId: new ObjectId() }),
      findOneAndUpdate: vi
        .fn<MockFunction<Collection["findOneAndUpdate"]>>()
        .mockResolvedValue(null),
      aggregate: vi.fn<MockFunction<Collection["aggregate"]>>().mockReturnValue(
        fromPartial<ReturnType<Collection["aggregate"]>>({
          toArray: vi.fn<MockFunction<FindCursor["toArray"]>>().mockResolvedValue([]),
        }),
      ),
    });
    mockDb = fromPartial<NativeMock<Db>>({
      collection: vi
        .fn<MockFunction<Db["collection"]>>()
        .mockReturnValue(fromPartial<Collection>(mockCollection)),
    });
    monque = new Monque(fromPartial<Db>(mockDb));
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("retains native callback cause identity after a successful management write", async () => {
    await monque.initialize();
    const failure = new MongoServerError({ message: "Observer failed", code: 91 });
    mockCollection.findOneAndUpdate.mockResolvedValueOnce(JobFactoryHelpers.cancelled());
    monque.on("job:cancelled", () => {
      throw failure;
    });
    await expect(monque.cancelJob(new ObjectId().toHexString())).rejects.toMatchObject({
      message: "Failed to cancel job: Observer failed",
      cause: failure,
    });
  });

  it("preserves a domain error thrown by a synchronous management listener", async () => {
    await monque.initialize();
    const failure = new MonqueError("Observer domain failure");
    mockCollection.findOneAndUpdate.mockResolvedValueOnce(JobFactoryHelpers.cancelled());
    monque.on("job:cancelled", () => {
      throw failure;
    });
    await expect(monque.cancelJob(new ObjectId().toHexString())).rejects.toBe(failure);
  });

  it("retains the non-Error callback fallback after a successful management write", async () => {
    await monque.initialize();
    mockCollection.findOneAndUpdate.mockResolvedValueOnce(JobFactoryHelpers.cancelled());
    monque.on(
      "job:cancelled",
      vi.fn<() => void>().mockImplementationOnce(() => {
        // oxlint-disable-next-line typescript/only-throw-error, no-throw-literal -- Exercise arbitrary values thrown by public callbacks.
        throw "Observer unavailable";
      }),
    );
    await expect(monque.cancelJob(new ObjectId().toHexString())).rejects.toStrictEqual(
      new ConnectionError("Failed to cancel job: Unknown error during cancelJob"),
    );
  });

  describe("constructor", () => {
    it("should set maxListeners to 20", () => {
      expect(monque.getMaxListeners()).toBe(20);
    });
  });

  it.each(["cancelJobs", "retryJobs", "deleteJobs"] as const)(
    "%s preserves an original selector name getter failure",
    async (operation) => {
      await monque.initialize();
      const failure = new Error("Selector name unavailable");

      const selector = {
        get name(): string {
          throw failure;
        },
      };

      await expect(monque[operation](selector)).rejects.toBe(failure);
    },
  );

  it.each(["cancelJobs", "retryJobs", "deleteJobs"] as const)(
    "%s preserves an original selector status getter failure",
    async (operation) => {
      await monque.initialize();
      const failure = new Error("Selector status unavailable");

      const selector = {
        get status(): "pending" {
          throw failure;
        },
      };

      await expect(monque[operation](selector)).rejects.toBe(failure);
    },
  );
  describe("initialize", () => {
    it("should initialize successfully", async () => {
      await monque.initialize();
      expect(mockDb.collection).toHaveBeenCalledWith("monque_jobs");
      expect(mockCollection.createIndexes).toHaveBeenCalledOnce();
    });

    it("should be idempotent (multiple calls do nothing)", async () => {
      await monque.initialize();
      // Clear mocks to verify second call triggers nothing
      vi.clearAllMocks();
      await monque.initialize();
      expect({
        mockDbCollectionMockCallsLength: mockDb.collection.mock.calls.length,
        mockCollectionCreateIndexesMockCallsLength: mockCollection.createIndexes.mock.calls.length,
      }).toStrictEqual({
        mockDbCollectionMockCallsLength: 0,
        mockCollectionCreateIndexesMockCallsLength: 0,
      });
    });

    it("should throw ConnectionError if initialization fails", async () => {
      vi.spyOn(mockDb, "collection").mockImplementationOnce(() => {
        throw new Error("DB Connection Failed");
      });
      await expect(monque.initialize()).rejects.toThrow(ConnectionError);
    });

    it("keeps public operations unavailable until initialization finishes", async () => {
      const recovery: PromiseWithResolvers<void> = Promise.withResolvers();
      vi.mocked(mockCollection.updateMany).mockImplementationOnce(async () => {
        await recovery.promise;

        return {
          acknowledged: true,
          matchedCount: 0,
          modifiedCount: 0,
          upsertedCount: 0,
          upsertedId: null,
        };
      });
      const initializing = monque.initialize();
      await expect(monque.enqueue("test-job", {})).rejects.toThrow(ConnectionError);
      expect(() => {
        monque.start();
      }).toThrow(ConnectionError);
      expect(mockCollection.insertOne).not.toHaveBeenCalled();
      recovery.resolve();
      await initializing;
      await expect(monque.enqueue("test-job", {})).resolves.toMatchObject({ name: "test-job" });
    });

    it("shares initialization failures and allows a later retry", async () => {
      const indexes = Promise.withResolvers<string[]>();
      vi.mocked(mockCollection.createIndexes).mockReturnValueOnce(indexes.promise);

      const failedInitializations = Promise.all(
        [monque.initialize(), monque.initialize()].map(async (initialization) => {
          await expect(initialization).rejects.toThrow(
            new ConnectionError("Failed to initialize Monque: DB unavailable"),
          );
        }),
      );

      indexes.reject(new Error("DB unavailable"));
      await failedInitializations;
      expect(mockCollection.createIndexes).toHaveBeenCalledOnce();
      await expect(monque.getJob("invalid-id")).rejects.toThrow(ConnectionError);
      expect(() => {
        monque.start();
      }).toThrow(ConnectionError);
      await monque.initialize();
      await expect(monque.getJob("invalid-id")).resolves.toBeNull();
      expect(mockCollection.createIndexes).toHaveBeenCalledTimes(2);
    });

    it("retries failed ownership recovery without publishing partially initialized modules", async () => {
      const recovery = Promise.withResolvers<Awaited<ReturnType<Collection["updateMany"]>>>();
      let recoveryAttempts = 0;
      vi.mocked(mockCollection.updateMany).mockImplementation(async (filter) => {
        if (filter["status"] === "processing") {
          const attempt = recoveryAttempts;
          recoveryAttempts += 1;

          if (attempt === 0) {
            return await recovery.promise;
          }
        }

        return {
          acknowledged: true,
          matchedCount: 0,
          modifiedCount: 0,
          upsertedCount: 0,
          upsertedId: null,
        };
      });
      const initializing = Promise.allSettled([monque.initialize(), monque.initialize()]);
      expect(() => {
        monque.start();
      }).toThrow(ConnectionError);
      await expect(monque.getJob(new ObjectId())).rejects.toThrow(ConnectionError);
      recovery.reject(new Error("Recovery unavailable"));
      const [first, second] = await initializing;

      if (first?.status !== "rejected" || second?.status !== "rejected") {
        throw new Error("Expected both initializations to reject");
      }

      const firstFailure: unknown = first.reason;
      const secondFailure: unknown = second.reason;
      expect(firstFailure).toBeInstanceOf(ConnectionError);
      expect({
        failures0: firstFailure,
        failures1: Object.is(secondFailure, firstFailure),
        recoveryAttempts: Object.is(recoveryAttempts, 1),
        mockCollectionFindOneMockCallsLength: mockCollection.findOne.mock.calls.length,
      }).toStrictEqual({
        failures0: new ConnectionError("Failed to initialize Monque: Recovery unavailable"),
        failures1: true,
        recoveryAttempts: true,
        mockCollectionFindOneMockCallsLength: 0,
      });
      await monque.initialize();

      const recoveredState = {
        recoveryAttempts,
        findOneCalls: mockCollection.findOne.mock.calls.length,
      };

      const missingJob = await monque.getJob(new ObjectId());
      const recoveredJob = await monque.enqueue("recovered", {});
      expect({
        ...recoveredState,
        missingJob,
        recoveredName: recoveredJob.name,
        recoveredStatus: recoveredJob.status,
        healthy: monque.isHealthy(),
      }).toStrictEqual({
        recoveryAttempts: 2,
        findOneCalls: 1,
        missingJob: null,
        recoveredName: "recovered",
        recoveredStatus: "pending",
        healthy: false,
      });
    });

    it("shares initialization work and keeps ownership of started resources", async () => {
      vi.useFakeTimers();
      const initialization = Promise.withResolvers<null>();
      vi.mocked(mockCollection.findOne)
        .mockResolvedValueOnce(null)
        .mockReturnValueOnce(initialization.promise);
      const stream = createStream();

      const watch = vi
        .fn<MockFunction<Collection["watch"]>>()
        .mockReturnValue(fromPartial<ChangeStream>(stream));

      Object.assign(mockCollection, { watch });

      try {
        const first = monque.initialize();
        const second = monque.initialize();
        await first;
        monque.start();
        initialization.resolve(null);
        await second;
        expect({
          monqueIsHealthy: Object.is(monque.isHealthy(), true),
          mockCollectionCreateIndexesMockCallsLength:
            mockCollection.createIndexes.mock.calls.length,
          mockCollectionFindOneMockCallsLength: mockCollection.findOne.mock.calls.length,
        }).toStrictEqual({
          monqueIsHealthy: true,
          mockCollectionCreateIndexesMockCallsLength: 1,
          mockCollectionFindOneMockCallsLength: 1,
        });
        await monque.initialize();
        await monque.stop();
        expect({
          watchMockCallsLength: watch.mock.calls.length,
          streamCloseMockCallsLength: stream.close.mock.calls.length,
          getTimerCount: Object.is(vi.getTimerCount(), 0),
        }).toStrictEqual({
          watchMockCallsLength: 1,
          streamCloseMockCallsLength: 1,
          getTimerCount: true,
        });
      } finally {
        vi.clearAllTimers();
        vi.useRealTimers();
      }
    });

    it("should skip index creation when skipIndexCreation is true", async () => {
      const skipMonque = new Monque(fromPartial<Db>(mockDb), { skipIndexCreation: true });
      await skipMonque.initialize();
      expect(mockDb.collection).toHaveBeenCalledWith("monque_jobs");
      expect(mockCollection.createIndexes).not.toHaveBeenCalled();
    });

    it("should create compound index for job retention when configured", async () => {
      const retentionMonque = new Monque(fromPartial<Db>(mockDb), {
        jobRetention: { completed: 10_000 },
      });

      await retentionMonque.initialize();
      const { calls } = vi.mocked(mockCollection.createIndexes).mock;
      expect(calls[0]?.[0]).toContainEqual(
        objectContainingMatcher({
          key: { status: 1, updatedAt: 1 },
          background: true,
          partialFilterExpression: objectContainingMatcher({
            updatedAt: { $exists: true },
            status: { $in: arrayContainingMatcher(["completed", "failed"]) },
          }),
        }),
      );
    });

    it("should not create index for job retention when omitted", async () => {
      const MonqueInstance = new Monque(fromPartial<Db>(mockDb), {});
      await MonqueInstance.initialize();
      const { calls } = vi.mocked(mockCollection.createIndexes).mock;
      expect(calls[0]?.[0]).not.toContainEqual(
        objectContainingMatcher({
          key: { status: 1, updatedAt: 1 },
        }),
      );
    });
  });
  describe("uninitialized state", () => {
    it("should throw ConnectionError when calling public methods before initialize", async () => {
      // Enqueue
      await expect(monque.enqueue("test", {})).rejects.toThrow(ConnectionError);
      // Schedule
      await expect(monque.schedule("* * * * *", "test", {})).rejects.toThrow(ConnectionError);
      // Get
      await expect(monque.getJob(new ObjectId())).rejects.toThrow(ConnectionError);
      // Queue View summaries
      await expect(monque.getQueueViewSummaries()).rejects.toThrow(ConnectionError);
      // Management
      await expect(monque.cancelJob("123")).rejects.toThrow(ConnectionError);
    });

    it("rejects invalid identifiers before initialization with the initialization error", async () => {
      await expect(monque.enqueue("invalid job", {})).rejects.toThrow(ConnectionError);
      await expect(monque.getJob("invalid-id")).rejects.toThrow(ConnectionError);
      expect(() => {
        monque.start();
      }).toThrow(ConnectionError);
      expect({
        mockCollectionInsertOneMockCallsLength: mockCollection.insertOne.mock.calls.length,
        mockCollectionFindOneMockCallsLength: mockCollection.findOne.mock.calls.length,
      }).toStrictEqual({
        mockCollectionInsertOneMockCallsLength: 0,
        mockCollectionFindOneMockCallsLength: 0,
      });
    });
  });
  describe("restart during shutdown", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.clearAllTimers();
      vi.useRealTimers();
    });

    it("leaves no maintenance after a connected listener stops synchronously", async () => {
      const stream = createStream();
      Object.assign(mockCollection, {
        watch: vi
          .fn<MockFunction<Collection["watch"]>>()
          .mockReturnValue(fromPartial<ChangeStream>(stream)),
      });
      monque = new Monque(fromPartial<Db>(mockDb), {
        recoverStaleJobs: false,
        heartbeatInterval: 1000,
        jobRetention: { completed: 0, interval: 1000 },
      });
      await monque.initialize();
      let stopping: Promise<void> | undefined;
      monque.once("changestream:connected", () => {
        stopping = monque.stop();
      });
      monque.start();
      await stopping;
      expect(monque.isHealthy()).toBe(false);
      await vi.advanceTimersByTimeAsync(5000);
      expect(mockCollection.deleteMany).not.toHaveBeenCalled();
      expect(stream.close).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("preserves replacement maintenance cadence after a connected listener stops and restarts", async () => {
      const monotonic = vi
        .spyOn(Effect.runSync(Clock.Clock), "monotonicTimeNanosUnsafe")
        .mockImplementation(readMonotonicNanos);

      const oldStream = createStream();
      const replacement = createStream();
      Object.assign(mockCollection, {
        watch: vi
          .fn<MockFunction<Collection["watch"]>>()
          .mockReturnValueOnce(fromPartial<ChangeStream>(oldStream))
          .mockReturnValue(fromPartial<ChangeStream>(replacement)),
      });
      monque = new Monque(fromPartial<Db>(mockDb), {
        recoverStaleJobs: false,
        heartbeatInterval: 1000,
        jobRetention: { completed: 0, interval: 1000 },
      });
      await monque.initialize();
      let stopping: Promise<void> | undefined;
      monque.once("changestream:connected", () => {
        stopping = monque.stop();
        monque.start();
        // Synchronous application work must not move the successor's retention deadline.
        vi.advanceTimersByTime(500);
      });

      try {
        monque.start();
        await stopping;
        expect(monque.isHealthy()).toBe(true);
        expect(replacement.close).not.toHaveBeenCalled();
        expect(mockCollection.deleteMany).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(500);
        expect(mockCollection.deleteMany).toHaveBeenCalledTimes(2);
      } finally {
        await monque.stop();
        monotonic.mockRestore();
      }

      const deletionsAfterStop = mockCollection.deleteMany.mock.calls.length;
      await vi.advanceTimersByTimeAsync(5000);
      expect(mockCollection.deleteMany).toHaveBeenCalledTimes(deletionsAfterStop);
      expect(oldStream.close).toHaveBeenCalledOnce();
      expect(replacement.close).toHaveBeenCalledOnce();
      expect(monque.isHealthy()).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("releases maintenance acquired while a native retention callback stops synchronously", async () => {
      const stream = createStream();
      Object.assign(mockCollection, {
        watch: vi
          .fn<MockFunction<Collection["watch"]>>()
          .mockReturnValue(fromPartial<ChangeStream>(stream)),
      });
      monque = new Monque(fromPartial<Db>(mockDb), {
        recoverStaleJobs: false,
        heartbeatInterval: 1000,
        jobRetention: { completed: 0, interval: 1000 },
      });
      await monque.initialize();
      let stopping: Promise<void> | undefined;
      const deletion = Promise.withResolvers<Awaited<ReturnType<Collection["deleteMany"]>>>();
      mockCollection.deleteMany.mockImplementationOnce(async () => {
        stopping = monque.stop();

        return await deletion.promise;
      });
      monque.start();
      await stopping;
      deletion.resolve({ acknowledged: true, deletedCount: 0 });
      await vi.advanceTimersByTimeAsync(5000);
      expect(mockCollection.deleteMany).toHaveBeenCalledOnce();
      expect(monque.isHealthy()).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("keeps a replacement stream active when an error listener restarts synchronously", async () => {
      const oldStream = createStream();
      const replacement = createStream();
      Object.assign(mockCollection, {
        options: vi.fn<() => Promise<Record<string, never>>>().mockResolvedValue({}),
        watch: vi
          .fn<MockFunction<Collection["watch"]>>()
          .mockReturnValueOnce(fromPartial<ChangeStream>(oldStream))
          .mockReturnValue(fromPartial<ChangeStream>(replacement)),
      });
      monque.register("work", async () => {});
      await monque.initialize();
      // Count only runtime renewals, excluding initialization normalization/recovery.
      vi.mocked(mockCollection.updateMany).mockClear();
      monque.start();
      await vi.advanceTimersByTimeAsync(0);
      const stopping: PromiseWithResolvers<void> = Promise.withResolvers();
      monque.once("changestream:error", () => {
        // oxlint-disable-next-line promise/prefer-catch, promise/catch-or-return -- Settle either outcome in the same Promise reaction before the restart assertions.
        monque.stop().then(stopping.resolve, stopping.reject);
        monque.start();
      });

      try {
        oldStream.emit("error", new Error("Restart from the error listener"));
        await stopping.promise;
        expect.soft(replacement.close).not.toHaveBeenCalled();
        replacement.emit("change", {
          operationType: "insert",
          fullDocument: { name: "work", status: "pending", nextRunAt: new Date() },
        });
        await vi.advanceTimersByTimeAsync(100);
        expect.soft(mockCollection.findOneAndUpdate).toHaveBeenCalledOnce();
      } finally {
        await monque.stop();
      }

      expect({
        oldStreamCloseMockCallsLength: oldStream.close.mock.calls.length,
        replacementCloseMockCallsLength: replacement.close.mock.calls.length,
        getTimerCount: Object.is(vi.getTimerCount(), 0),
      }).toStrictEqual({
        oldStreamCloseMockCallsLength: 1,
        replacementCloseMockCallsLength: 1,
        getTimerCount: true,
      });
    });

    it("ignores errors from the stream being closed", async () => {
      const closing: PromiseWithResolvers<void> = Promise.withResolvers();
      const stream = createStream(closing.promise);
      Object.assign(mockCollection, {
        watch: vi
          .fn<MockFunction<Collection["watch"]>>()
          .mockReturnValue(fromPartial<ChangeStream>(stream)),
      });
      const onStreamError = vi.fn<(payload: MonqueEventMap["changestream:error"]) => void>();
      monque.on("changestream:error", onStreamError);
      await monque.initialize();
      // Count only runtime renewals, excluding initialization normalization/recovery.
      vi.mocked(mockCollection.updateMany).mockClear();
      monque.start();
      const stopping = monque.stop();
      stream.emit("error", new Error("The old cursor is closing"));
      closing.resolve();
      await stopping;
      expect({
        onStreamErrorMockCallsLength: onStreamError.mock.calls.length,
        getTimerCount: Object.is(vi.getTimerCount(), 0),
      }).toStrictEqual({
        onStreamErrorMockCallsLength: 0,
        getTimerCount: true,
      });
    });

    it.each([undefined, 3000])(
      "keeps restarted timers and stream delivery when the previous stream finishes closing (lease: %s)",
      async (leaseDuration) => {
        const options: MonqueOptions = {
          heartbeatInterval: 1000,
        };

        if (leaseDuration !== undefined) {
          options.leaseDuration = leaseDuration;
        }

        monque = new Monque(fromPartial<Db>(mockDb), options);
        const closing: PromiseWithResolvers<void> = Promise.withResolvers();
        const oldStream = createStream(closing.promise);
        const newStream = createStream();
        Object.assign(mockCollection, {
          options: vi.fn<() => Promise<Record<string, never>>>().mockResolvedValue({}),
          watch: vi
            .fn<MockFunction<Collection["watch"]>>()
            .mockReturnValueOnce(fromPartial<ChangeStream>(oldStream))
            .mockReturnValueOnce(fromPartial<ChangeStream>(newStream)),
        });
        monque.register("work", async () => {});
        await monque.initialize();
        // Count only runtime renewals, excluding initialization normalization/recovery.
        vi.mocked(mockCollection.updateMany).mockClear();
        monque.start();
        await vi.advanceTimersByTimeAsync(0);
        const stopping = monque.stop();
        monque.start();
        closing.resolve();
        await stopping;
        await vi.advanceTimersByTimeAsync(0);
        expect(monque.isHealthy()).toBe(true);
        expect.soft(vi.getTimerCount()).toBe(2);
        newStream.emit("change", {
          operationType: "insert",
          fullDocument: { name: "work", status: "pending", nextRunAt: new Date() },
        });
        await vi.advanceTimersByTimeAsync(100);
        expect.soft(mockCollection.findOneAndUpdate).toHaveBeenCalledOnce();
        await monque.stop();
        expect.soft(oldStream.close).toHaveBeenCalledOnce();
        expect.soft(newStream.close).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
      },
    );

    it("drains only the jobs active when stop was called and keeps restarted leases alive", async () => {
      monque = new Monque(fromPartial<Db>(mockDb), {
        workerConcurrency: 2,
        heartbeatInterval: 1000,
        leaseDuration: 3000,
        recoverStaleJobs: false,
        shutdownTimeout: 10_000,
      });
      const closing: PromiseWithResolvers<void> = Promise.withResolvers();
      const oldStream = createStream(closing.promise);
      const newStream = createStream();
      Object.assign(mockCollection, {
        watch: vi
          .fn<MockFunction<Collection["watch"]>>()
          .mockReturnValueOnce(fromPartial<ChangeStream>(oldStream))
          .mockReturnValueOnce(fromPartial<ChangeStream>(newStream)),
      });
      const oldStarted: PromiseWithResolvers<void> = Promise.withResolvers();
      const newStarted: PromiseWithResolvers<void> = Promise.withResolvers();
      const oldHandler: PromiseWithResolvers<void> = Promise.withResolvers();
      const newHandler: PromiseWithResolvers<void> = Promise.withResolvers();
      const oldJob = JobFactoryHelpers.processing({ name: "work", claimId: "old-claim" });
      const newJob = JobFactoryHelpers.processing({ name: "work", claimId: "new-claim" });
      vi.mocked(mockCollection.findOneAndUpdate)
        .mockResolvedValueOnce(oldJob)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(newJob);
      monque.register("work", async (job) => {
        if (job.claimId === oldJob.claimId) {
          oldStarted.resolve();
          await oldHandler.promise;
        } else {
          newStarted.resolve();
          await newHandler.promise;
        }
      });
      await monque.initialize();
      // Count only runtime renewals, excluding initialization normalization/recovery.
      vi.mocked(mockCollection.updateMany).mockClear();
      monque.start();
      await oldStarted.promise;
      await vi.advanceTimersByTimeAsync(0);
      let stopped = false;

      // oxlint-disable-next-line promise/always-return -- Observe Promise<void> completion in this reaction; the chain is awaited below.
      const stopping = monque.stop().then(() => {
        stopped = true;
      });

      monque.start();
      await newStarted.promise;
      await vi.advanceTimersByTimeAsync(1000);
      expect.soft(mockCollection.updateMany).toHaveBeenCalledOnce();
      oldHandler.resolve();
      await vi.advanceTimersByTimeAsync(0);
      closing.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect.soft(stopped).toBe(true);
      expect(monque.isHealthy()).toBe(true);
      await vi.advanceTimersByTimeAsync(1000);
      expect.soft(mockCollection.updateMany).toHaveBeenCalledTimes(2);
      expect
        .soft(mockCollection.updateMany)
        .toHaveBeenLastCalledWith(
          objectContainingMatcher({ claimId: { $in: ["new-claim"] } }),
          anyMatcher(Array),
        );
      const nextStopping = monque.stop();
      await vi.advanceTimersByTimeAsync(1000);
      expect.soft(mockCollection.updateMany).toHaveBeenCalledTimes(3);
      newHandler.resolve();
      await vi.advanceTimersByTimeAsync(10_000);
      await Promise.all([stopping, nextStopping]);
      expect.soft(newStream.close).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("keeps lease renewal for a restarted run that has already begun draining", async () => {
      monque = new Monque(fromPartial<Db>(mockDb), {
        workerConcurrency: 1,
        heartbeatInterval: 1000,
        leaseDuration: 3000,
        recoverStaleJobs: false,
        shutdownTimeout: 10_000,
      });
      const closing: PromiseWithResolvers<void> = Promise.withResolvers();
      const oldStream = createStream(closing.promise);
      const newStream = createStream();
      Object.assign(mockCollection, {
        watch: vi
          .fn<MockFunction<Collection["watch"]>>()
          .mockReturnValueOnce(fromPartial<ChangeStream>(oldStream))
          .mockReturnValueOnce(fromPartial<ChangeStream>(newStream)),
      });
      await monque.initialize();
      // Count only runtime renewals, excluding initialization normalization/recovery.
      vi.mocked(mockCollection.updateMany).mockClear();
      monque.start();
      let firstStopped = false;

      // oxlint-disable-next-line promise/always-return -- Observe Promise<void> completion in this reaction; the chain is awaited below.
      const firstStopping = monque.stop().then(() => {
        firstStopped = true;
      });

      const started: PromiseWithResolvers<void> = Promise.withResolvers();
      const handler: PromiseWithResolvers<void> = Promise.withResolvers();
      vi.mocked(mockCollection.findOneAndUpdate).mockResolvedValueOnce(
        JobFactoryHelpers.processing({ name: "work", claimId: "new-claim" }),
      );
      monque.register("work", async () => {
        started.resolve();
        await handler.promise;
      });
      monque.start();
      await started.promise;
      let secondStopped = false;

      // oxlint-disable-next-line promise/always-return -- Observe Promise<void> completion in this reaction; the chain is awaited below.
      const secondStopping = monque.stop().then(() => {
        secondStopped = true;
      });

      closing.resolve();
      await vi.advanceTimersByTimeAsync(1000);
      expect.soft(firstStopped).toBe(true);
      expect({
        secondStopped: Object.is(secondStopped, false),
        monqueIsHealthy: Object.is(monque.isHealthy(), false),
      }).toStrictEqual({
        secondStopped: true,
        monqueIsHealthy: true,
      });
      expect.soft(mockCollection.updateMany).toHaveBeenCalledOnce();
      handler.resolve();
      await vi.advanceTimersByTimeAsync(10_000);
      await Promise.all([firstStopping, secondStopping]);
      expect({
        oldStreamCloseMockCallsLength: oldStream.close.mock.calls.length,
        newStreamCloseMockCallsLength: newStream.close.mock.calls.length,
        getTimerCount: Object.is(vi.getTimerCount(), 0),
      }).toStrictEqual({
        oldStreamCloseMockCallsLength: 1,
        newStreamCloseMockCallsLength: 1,
        getTimerCount: true,
      });
    });

    it("reports only original incomplete jobs when shutdown times out after a restart", async () => {
      monque = new Monque(fromPartial<Db>(mockDb), {
        workerConcurrency: 2,
        heartbeatInterval: 1000,
        leaseDuration: 3000,
        recoverStaleJobs: false,
        shutdownTimeout: 2000,
      });
      const closing: PromiseWithResolvers<void> = Promise.withResolvers();
      const oldStream = createStream(closing.promise);
      const newStream = createStream();
      Object.assign(mockCollection, {
        watch: vi
          .fn<MockFunction<Collection["watch"]>>()
          .mockReturnValueOnce(fromPartial<ChangeStream>(oldStream))
          .mockReturnValueOnce(fromPartial<ChangeStream>(newStream)),
      });
      const shutdownErrors: ShutdownTimeoutError[] = [];
      monque.on("job:error", ({ error }) => {
        if (error instanceof ShutdownTimeoutError) {
          shutdownErrors.push(error);
        }
      });
      const oldStarted: PromiseWithResolvers<void> = Promise.withResolvers();
      const newStarted: PromiseWithResolvers<void> = Promise.withResolvers();
      const oldHandler: PromiseWithResolvers<void> = Promise.withResolvers();
      const newHandler: PromiseWithResolvers<void> = Promise.withResolvers();
      const oldJob = JobFactoryHelpers.processing({ name: "work", claimId: "old-claim" });
      const newJob = JobFactoryHelpers.processing({ name: "work", claimId: "new-claim" });
      vi.mocked(mockCollection.findOneAndUpdate)
        .mockResolvedValueOnce(oldJob)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(newJob);
      monque.register("work", async (job) => {
        if (job.claimId === oldJob.claimId) {
          oldStarted.resolve();
          await oldHandler.promise;
        } else {
          newStarted.resolve();
          await newHandler.promise;
        }
      });
      await monque.initialize();
      // Count only runtime renewals, excluding initialization normalization/recovery.
      vi.mocked(mockCollection.updateMany).mockClear();
      monque.start();
      await oldStarted.promise;
      await vi.advanceTimersByTimeAsync(0);
      const stopping = monque.stop();
      monque.start();
      await newStarted.promise;
      closing.resolve();
      await vi.advanceTimersByTimeAsync(3000);
      await stopping;
      expect({
        shutdownErrorsLength: shutdownErrors.length,
        shutdownErrors0IncompleteJobs: shutdownErrors[0]?.incompleteJobs,
        monqueIsHealthy: Object.is(monque.isHealthy(), true),
        newStreamCloseMockCallsLength: newStream.close.mock.calls.length,
        mockCollectionUpdateManyMockCallsLength: mockCollection.updateMany.mock.calls.length,
      }).toStrictEqual({
        shutdownErrorsLength: 1,
        shutdownErrors0IncompleteJobs: [oldJob],
        monqueIsHealthy: true,
        newStreamCloseMockCallsLength: 0,
        mockCollectionUpdateManyMockCallsLength: 3,
      });
      const nextStopping = monque.stop();
      oldHandler.resolve();
      newHandler.resolve();
      await vi.advanceTimersByTimeAsync(0);
      await nextStopping;
      expect({
        shutdownErrorsLength: shutdownErrors.length,
        oldStreamCloseMockCallsLength: oldStream.close.mock.calls.length,
        newStreamCloseMockCallsLength: newStream.close.mock.calls.length,
        getTimerCount: Object.is(vi.getTimerCount(), 0),
      }).toStrictEqual({
        shutdownErrorsLength: 1,
        oldStreamCloseMockCallsLength: 1,
        newStreamCloseMockCallsLength: 1,
        getTimerCount: true,
      });
    });

    it.each([undefined, 3000])(
      "resolves overlapping stops when their shared active handler finishes (lease: %s)",
      async (leaseDuration) => {
        const options: MonqueOptions = {
          workerConcurrency: 1,
          heartbeatInterval: 1000,
          recoverStaleJobs: false,
          shutdownTimeout: 10_000,
        };

        if (leaseDuration !== undefined) {
          options.leaseDuration = leaseDuration;
        }

        monque = new Monque(fromPartial<Db>(mockDb), options);
        const firstClosing: PromiseWithResolvers<void> = Promise.withResolvers();
        const secondClosing: PromiseWithResolvers<void> = Promise.withResolvers();
        const firstStream = createStream(firstClosing.promise);
        const secondStream = createStream(secondClosing.promise);
        Object.assign(mockCollection, {
          watch: vi
            .fn<MockFunction<Collection["watch"]>>()
            .mockReturnValueOnce(fromPartial<ChangeStream>(firstStream))
            .mockReturnValueOnce(fromPartial<ChangeStream>(secondStream)),
        });
        const started: PromiseWithResolvers<void> = Promise.withResolvers();
        const handler: PromiseWithResolvers<void> = Promise.withResolvers();
        vi.mocked(mockCollection.findOneAndUpdate).mockResolvedValueOnce(
          JobFactoryHelpers.processing({ name: "work", claimId: "shared-claim" }),
        );
        monque.register("work", async () => {
          started.resolve();
          await handler.promise;
        });
        await monque.initialize();
        // Count only runtime renewals, excluding initialization normalization/recovery.
        vi.mocked(mockCollection.updateMany).mockClear();
        monque.start();
        await started.promise;
        let firstStopped = false;
        let secondStopped = false;

        // oxlint-disable-next-line promise/always-return -- Observe Promise<void> completion in this reaction; the chain is awaited below.
        const firstStopping = monque.stop().then(() => {
          firstStopped = true;
        });

        monque.start();

        // oxlint-disable-next-line promise/always-return -- Observe Promise<void> completion in this reaction; the chain is awaited below.
        const secondStopping = monque.stop().then(() => {
          secondStopped = true;
        });

        firstClosing.resolve();
        secondClosing.resolve();
        await vi.advanceTimersByTimeAsync(1000);
        expect({
          firstStopped: Object.is(firstStopped, false),
          secondStopped: Object.is(secondStopped, false),
        }).toStrictEqual({
          firstStopped: true,
          secondStopped: true,
        });
        expect
          .soft(mockCollection.updateMany)
          .toHaveBeenCalledTimes(leaseDuration === undefined ? 0 : 1);
        handler.resolve();
        await vi.advanceTimersByTimeAsync(0);
        expect.soft(firstStopped).toBe(true);
        expect.soft(secondStopped).toBe(true);
        expect.soft(vi.getTimerCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(10_000);
        await Promise.all([firstStopping, secondStopping]);
        expect({
          firstStreamCloseMockCallsLength: firstStream.close.mock.calls.length,
          secondStreamCloseMockCallsLength: secondStream.close.mock.calls.length,
          getTimerCount: Object.is(vi.getTimerCount(), 0),
        }).toStrictEqual({
          firstStreamCloseMockCallsLength: 1,
          secondStreamCloseMockCallsLength: 1,
          getTimerCount: true,
        });
      },
    );
  });
  describe("worker registration", () => {
    it("applies registration and pause changes immediately while initialization is pending", async () => {
      const indexes = Promise.withResolvers<string[]>();
      mockCollection.createIndexes.mockReturnValueOnce(indexes.promise);
      const initializing = monque.initialize();
      monque.register("work", () => {}, { concurrency: 2, maxRetries: 4 });
      monque.pause("work");
      monque.pause();
      monque.resume();
      expect(monque.getProcessingState("work")).toMatchObject({
        paused: true,
        globallyPaused: false,
      });
      expect(monque.isHealthy()).toBe(false);
      expect(() => {
        monque.register("work", () => {});
      }).toThrow(WorkerRegistrationError);
      monque.register("work", () => {}, { replace: true, concurrency: 3 });
      indexes.resolve([]);
      await initializing;
      await expect(monque.getQueueViewSummaries()).resolves.toMatchObject([
        { name: "work", worker: { concurrency: 3, paused: true, maxRetries: 10 } },
      ]);
      monque.resume("work");
      expect(monque.isPaused("work")).toBe(false);
    });

    it("should throw WorkerRegistrationError on duplicate registration", () => {
      const handler = vi.fn<JobHandler>().mockResolvedValue(undefined);
      monque.register("test-job", handler);
      expect(() => {
        monque.register("test-job", handler);
      }).toThrow(WorkerRegistrationError);
    });

    it("exposes replacement concurrency in the Queue View", async () => {
      const handler1 = vi.fn<JobHandler>().mockResolvedValue(undefined);
      const handler2 = vi.fn<JobHandler>().mockResolvedValue(undefined);
      monque.register("test-job", handler1);
      monque.register("test-job", handler2, { replace: true, concurrency: 3 });
      await monque.initialize();
      await expect(monque.getQueueViewSummaries()).resolves.toMatchObject([
        { name: "test-job", worker: { concurrency: 3, activeCount: 0 } },
      ]);
    });

    it("should reject invalid worker names", () => {
      const handler = vi.fn<JobHandler>().mockResolvedValue(undefined);
      expect(() => {
        monque.register("invalid worker", handler);
      }).toThrow(InvalidJobIdentifierError);
      expect(() => {
        monque.register("\u0000", handler);
      }).toThrow(InvalidJobIdentifierError);
    });
  });
  describe("public operations", () => {
    beforeEach(async () => {
      await monque.initialize();
      vi.clearAllMocks();
    });

    it("rejects invalid enqueue job names before persistence", async () => {
      await expect(monque.enqueue("invalid job", { foo: "bar" })).rejects.toThrow(
        InvalidJobIdentifierError,
      );
      expect(mockCollection.insertOne).not.toHaveBeenCalled();
    });

    it("rejects invalid enqueue unique keys before persistence", async () => {
      await expect(
        monque.enqueue("valid-job", { foo: "bar" }, { uniqueKey: "   " }),
      ).rejects.toThrow(InvalidJobIdentifierError);
      expect(mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it("rejects invalid scheduled job names before persistence", async () => {
      await expect(monque.schedule("* * * * *", "bad name", {})).rejects.toThrow(
        InvalidJobIdentifierError,
      );
      expect(mockCollection.insertOne).not.toHaveBeenCalled();
    });

    it("rejects invalid immediate job names before persistence", async () => {
      await expect(monque.now("bad name", {})).rejects.toThrow(InvalidJobIdentifierError);
      expect(mockCollection.insertOne).not.toHaveBeenCalled();
    });

    it("converts Management string IDs before querying MongoDB", async () => {
      const job = JobFactoryHelpers.pending();
      vi.mocked(mockCollection.findOne).mockResolvedValue(job);
      await expect(monque.getJob(job._id.toHexString())).resolves.toStrictEqual(job);
      expect(mockCollection.findOne).toHaveBeenCalledWith({ _id: job._id });
    });

    it("returns null for invalid string IDs without querying MongoDB", async () => {
      await expect(monque.getJob("invalid-id")).resolves.toBeNull();
      expect(mockCollection.findOne).not.toHaveBeenCalled();
    });

    it("retains the original native read failure as the public ConnectionError cause", async () => {
      const failure = new MongoServerError({ message: "Read unavailable", code: 91 });
      failure.addErrorLabel("RetryableReadError");
      mockCollection.findOne.mockRejectedValueOnce(failure);

      const [result] = await Promise.allSettled([monque.getJob(new ObjectId())]);

      if (result?.status !== "rejected") {
        throw new Error("Expected read to reject");
      }

      const error: unknown = result.reason;

      if (!(error instanceof ConnectionError)) {
        throw new TypeError("Expected ConnectionError");
      }

      expect(error.message).toBe("Failed to get job: Read unavailable");
      expect(error.cause).toBe(failure);
      expect(failure.hasErrorLabel("RetryableReadError")).toBe(true);
    });

    it.each([
      "getJobs",
      "getJobsWithCursor",
      "getJobSummariesWithCursor",
      "getQueueStats",
      "getQueueViewSummaries",
    ] as const)("%s keeps the native failure when cursor cleanup also fails", async (operation) => {
      const failure = new MongoServerError({ message: "Read unavailable", code: 91 });
      failure.addErrorLabel("RetryableReadError");

      const close = vi
        .fn<() => Promise<void>>()
        .mockRejectedValue(new Error("Cleanup unavailable"));

      const cursor = fromPartial<ReturnType<Collection["find"]>>({
        sort: vi.fn<MockFunction<FindCursor["sort"]>>().mockReturnThis(),
        skip: vi.fn<MockFunction<FindCursor["skip"]>>().mockReturnThis(),
        limit: vi.fn<MockFunction<FindCursor["limit"]>>().mockReturnThis(),
        toArray: vi.fn<MockFunction<FindCursor["toArray"]>>().mockRejectedValue(failure),
        close,
      });

      Object.assign(mockCollection, {
        find: vi.fn<MockFunction<Collection["find"]>>().mockReturnValue(cursor),
      });
      mockCollection.aggregate.mockReturnValue(
        fromPartial<ReturnType<Collection["aggregate"]>>({
          toArray: cursor.toArray.bind(cursor),
          close: cursor.close.bind(cursor),
        }),
      );
      const [result] = await Promise.allSettled<unknown>([monque[operation]()]);

      if (result?.status !== "rejected") {
        throw new Error("Expected read to reject");
      }

      const error: unknown = result.reason;

      if (!(error instanceof ConnectionError)) {
        throw new TypeError("Expected ConnectionError");
      }

      expect(error.cause).toBe(failure);
      expect(close).toHaveBeenCalledOnce();
      expect(failure.hasErrorLabel("RetryableReadError")).toBe(true);
    });

    it.each(["getJobs", "getJobsWithCursor", "getJobSummariesWithCursor"] as const)(
      "%s releases its cursor when native query setup throws",
      async (operation) => {
        const failure = new MongoServerError({ message: "Cursor setup unavailable", code: 91 });
        failure.addErrorLabel("RetryableReadError");
        const close = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

        const find = vi.fn<MockFunction<Collection["find"]>>().mockReturnValue(
          fromPartial<ReturnType<Collection["find"]>>({
            sort: () => {
              throw failure;
            },
            close,
          }),
        );

        Object.assign(mockCollection, { find });
        const [result] = await Promise.allSettled<unknown>([monque[operation]()]);

        if (result?.status !== "rejected") {
          throw new Error("Expected read to reject");
        }

        const error: unknown = result.reason;
        expect(error).toBeInstanceOf(ConnectionError);
        expect(error).toHaveProperty("cause", failure);
        expect(close).toHaveBeenCalledOnce();
        expect(failure.hasErrorLabel("RetryableReadError")).toBe(true);
      },
    );

    it("keeps the established read error for non-Error rejections", async () => {
      mockCollection.findOne.mockRejectedValueOnce("Read unavailable");
      await expect(monque.getJob(new ObjectId())).rejects.toStrictEqual(
        new ConnectionError("Failed to get job: Unknown error during getJob"),
      );
    });

    it.each([
      "cancelJob",
      "retryJob",
      "rescheduleJob",
      "setJobPriority",
      "deleteJob",
      "cancelJobs",
      "retryJobs",
      "deleteJobs",
    ] as const)(
      "invalidates shared statistics after %s rejects a driver failure",
      async (action) => {
        const toArray = vi
          .fn<MockFunction<FindCursor["toArray"]>>()
          .mockResolvedValueOnce([{ statusCounts: [], avgDuration: [], total: [{ count: 1 }] }])
          .mockResolvedValueOnce([{ statusCounts: [], avgDuration: [], total: [{ count: 2 }] }]);

        mockCollection.aggregate.mockReturnValue(
          fromPartial<ReturnType<typeof mockCollection.aggregate>>({ toArray }),
        );
        const before = await monque.getQueueStats();
        expect(before.total).toBe(1);
        const failure = new MongoServerError({ message: "Partial write", code: 91 });
        mockCollection.findOneAndUpdate.mockRejectedValueOnce(failure);
        mockCollection.updateMany.mockRejectedValueOnce(failure);
        mockCollection.deleteOne.mockRejectedValueOnce(failure);
        mockCollection.deleteMany.mockRejectedValueOnce(failure);
        const id = new ObjectId().toHexString();

        const actions = {
          cancelJob: async () => await monque.cancelJob(id),
          retryJob: async () => await monque.retryJob(id),
          rescheduleJob: async () => await monque.rescheduleJob(id, new Date()),
          setJobPriority: async () => await monque.setJobPriority(id, 5),
          deleteJob: async () => await monque.deleteJob(id),
          cancelJobs: async () => await monque.cancelJobs({}),
          retryJobs: async () => await monque.retryJobs({}),
          deleteJobs: async () => await monque.deleteJobs({}),
        };

        const [result] = await Promise.allSettled([actions[action]()]);

        if (result?.status !== "rejected" || !(result.reason instanceof ConnectionError)) {
          throw new Error("Expected driver failure");
        }

        expect(result.reason.cause).toBe(failure);
        const after = await monque.getQueueStats();
        expect(after.total).toBe(2);
      },
    );

    it.each([false, true])(
      "refreshes cached statistics after a mutation (failed: %s)",
      async (fail) => {
        const toArray = vi
          .fn<MockFunction<FindCursor["toArray"]>>()
          .mockResolvedValueOnce([{ statusCounts: [], avgDuration: [], total: [{ count: 1 }] }])
          .mockResolvedValueOnce([{ statusCounts: [], avgDuration: [], total: [{ count: 2 }] }]);

        vi.mocked(mockCollection.aggregate).mockReturnValue(
          fromPartial<ReturnType<typeof mockCollection.aggregate>>({ toArray }),
        );
        const awaitedResult1 = await monque.getQueueStats();
        expect(awaitedResult1.total).toBe(1);
        const awaitedResult2 = await monque.getQueueStats();
        expect(awaitedResult2.total).toBe(1);

        if (fail) {
          vi.mocked(mockCollection.updateMany).mockRejectedValueOnce(new Error("Partial write"));
        }

        let result: BulkOperationResult | undefined;
        let mutationError: unknown;

        try {
          result = await monque.cancelJobs({});
        } catch (error) {
          mutationError = error;
        }

        expect({
          failed: mutationError instanceof ConnectionError,
          count: result?.count,
        }).toStrictEqual({ failed: fail, count: fail ? undefined : 0 });
        const awaitedResult3 = await monque.getQueueStats();
        expect(awaitedResult3.total).toBe(2);
      },
    );
  });
});
