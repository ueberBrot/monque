/**
 * Unit tests for Monque class.
 *
 * Tests initialization and public operations with the real internal modules.
 */

import { EventEmitter } from "node:events";
import { type Collection, type Db, ObjectId } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { Monque } from "@/scheduler/monque.js";
import {
  ConnectionError,
  InvalidJobIdentifierError,
  ShutdownTimeoutError,
  WorkerRegistrationError,
} from "@/shared";
import { JobFactoryHelpers } from "@tests/factories";

function createStream(closing = Promise.resolve()) {
  return Object.assign(new EventEmitter(), { close: vi.fn(() => closing) });
}

describe("Monque", () => {
  let mockDb: Db;
  let mockCollection: Collection;
  let monque: Monque;

  beforeEach(() => {
    mockCollection = {
      createIndexes: vi.fn().mockResolvedValue(["index_name"]),
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
      deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }),
      findOne: vi.fn().mockResolvedValue(null),
      insertOne: vi.fn().mockResolvedValue({ insertedId: new ObjectId() }),
      findOneAndUpdate: vi.fn().mockResolvedValue(null),
      aggregate: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    } as unknown as Collection;

    mockDb = {
      collection: vi.fn().mockReturnValue(mockCollection),
    } as unknown as Db;

    monque = new Monque(mockDb);
  });

  afterEach(() => {
    vi.clearAllMocks();
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

      expect(mockDb.collection).not.toHaveBeenCalled();
      expect(mockCollection.createIndexes).not.toHaveBeenCalled();
    });

    it("should throw ConnectionError if initialization fails", async () => {
      vi.spyOn(mockDb, "collection").mockImplementationOnce(() => {
        throw new Error("DB Connection Failed");
      });

      await expect(monque.initialize()).rejects.toThrow(ConnectionError);
    });

    it("keeps public operations unavailable until initialization finishes", async () => {
      const recovery = Promise.withResolvers<void>();
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
      expect(() => monque.start()).toThrow(ConnectionError);
      expect(mockCollection.insertOne).not.toHaveBeenCalled();

      recovery.resolve();
      await initializing;
      await expect(monque.enqueue("test-job", {})).resolves.toMatchObject({ name: "test-job" });
    });

    it("shares initialization failures and allows a later retry", async () => {
      const indexes = Promise.withResolvers<string[]>();
      vi.mocked(mockCollection.createIndexes).mockReturnValueOnce(indexes.promise);
      const first = expect(monque.initialize()).rejects.toThrow(
        new ConnectionError("Failed to initialize Monque: DB unavailable"),
      );
      const second = expect(monque.initialize()).rejects.toThrow(
        new ConnectionError("Failed to initialize Monque: DB unavailable"),
      );
      indexes.reject(new Error("DB unavailable"));
      await Promise.all([first, second]);

      expect(mockCollection.createIndexes).toHaveBeenCalledOnce();
      await expect(monque.getJob("invalid-id")).rejects.toThrow(ConnectionError);
      expect(() => monque.start()).toThrow(ConnectionError);

      await monque.initialize();
      await expect(monque.getJob("invalid-id")).resolves.toBeNull();
      expect(mockCollection.createIndexes).toHaveBeenCalledTimes(2);
    });

    it("retries failed ownership recovery without publishing partially initialized modules", async () => {
      const recovery = Promise.withResolvers<Awaited<ReturnType<Collection["updateMany"]>>>();
      let recoveryAttempts = 0;
      vi.mocked(mockCollection.updateMany).mockImplementation(async (filter) => {
        if (filter["status"] === "processing" && recoveryAttempts++ === 0) return recovery.promise;
        return {
          acknowledged: true,
          matchedCount: 0,
          modifiedCount: 0,
          upsertedCount: 0,
          upsertedId: null,
        };
      });
      const first = monque.initialize().catch((error: unknown) => error);
      const second = monque.initialize().catch((error: unknown) => error);

      expect(() => monque.start()).toThrow(ConnectionError);
      await expect(monque.getJob(new ObjectId())).rejects.toThrow(ConnectionError);
      recovery.reject(new Error("Recovery unavailable"));
      const failures = await Promise.all([first, second]);

      expect(failures[0]).toBeInstanceOf(ConnectionError);
      expect(failures[0]).toEqual(
        new ConnectionError("Failed to initialize Monque: Recovery unavailable"),
      );
      expect(failures[1]).toBe(failures[0]);
      expect(recoveryAttempts).toBe(1);
      expect(mockCollection.findOne).not.toHaveBeenCalled();

      await monque.initialize();
      expect(recoveryAttempts).toBe(2);
      expect(mockCollection.findOne).toHaveBeenCalledOnce();
      await expect(monque.getJob(new ObjectId())).resolves.toBeNull();
      await expect(monque.enqueue("recovered", {})).resolves.toMatchObject({
        name: "recovered",
        status: "pending",
      });
      expect(monque.isHealthy()).toBe(false);
    });

    it("shares initialization work and keeps ownership of started resources", async () => {
      vi.useFakeTimers();
      const initialization = Promise.withResolvers<null>();
      vi.mocked(mockCollection.findOne)
        .mockResolvedValueOnce(null)
        .mockReturnValueOnce(initialization.promise);
      const stream = createStream();
      const watch = vi.fn().mockReturnValue(stream);
      Object.assign(mockCollection, { watch });
      try {
        const first = monque.initialize();
        const second = monque.initialize();
        await first;
        monque.start();
        initialization.resolve(null);
        await second;
        expect(monque.isHealthy()).toBe(true);
        expect(mockCollection.createIndexes).toHaveBeenCalledOnce();
        expect(mockCollection.findOne).toHaveBeenCalledOnce();

        await monque.initialize();
        await monque.stop();
        expect(watch).toHaveBeenCalledOnce();
        expect(stream.close).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.clearAllTimers();
        vi.useRealTimers();
      }
    });

    it("should skip index creation when skipIndexCreation is true", async () => {
      const skipMonque = new Monque(mockDb, { skipIndexCreation: true });
      await skipMonque.initialize();

      expect(mockDb.collection).toHaveBeenCalledWith("monque_jobs");
      expect(mockCollection.createIndexes).not.toHaveBeenCalled();
    });

    it("should create compound index for job retention when configured", async () => {
      const retentionMonque = new Monque(mockDb, { jobRetention: { completed: 10000 } });
      await retentionMonque.initialize();

      const calls = vi.mocked(mockCollection.createIndexes).mock.calls;
      expect(calls[0]?.[0]).toContainEqual(
        expect.objectContaining({
          key: { status: 1, updatedAt: 1 },
          background: true,
          partialFilterExpression: expect.objectContaining({
            updatedAt: { $exists: true },
            status: { $in: expect.arrayContaining(["completed", "failed"]) },
          }),
        }),
      );
    });

    it("should not create index for job retention when omitted", async () => {
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
      expect(() => monque.start()).toThrow(ConnectionError);
      expect(mockCollection.insertOne).not.toHaveBeenCalled();
      expect(mockCollection.findOne).not.toHaveBeenCalled();
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

    it("keeps a replacement stream active when an error listener restarts synchronously", async () => {
      const oldStream = Object.assign(new EventEmitter(), {
        close: vi.fn().mockResolvedValue(undefined),
      });
      const replacement = Object.assign(new EventEmitter(), {
        close: vi.fn().mockResolvedValue(undefined),
      });
      Object.assign(mockCollection, {
        options: vi.fn().mockResolvedValue({}),
        watch: vi.fn().mockReturnValueOnce(oldStream).mockReturnValue(replacement),
      });
      monque.register("work", async () => {});
      await monque.initialize();
      // Count only runtime renewals, excluding initialization normalization/recovery.
      vi.mocked(mockCollection.updateMany).mockClear();
      monque.start();
      await vi.advanceTimersByTimeAsync(0);
      const stopping = Promise.withResolvers<void>();
      monque.once("changestream:error", () => {
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
      expect(oldStream.close).toHaveBeenCalledOnce();
      expect(replacement.close).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("ignores errors from the stream being closed", async () => {
      const closing = Promise.withResolvers<void>();
      const stream = createStream(closing.promise);
      Object.assign(mockCollection, { watch: vi.fn().mockReturnValue(stream) });
      const onStreamError = vi.fn();
      monque.on("changestream:error", onStreamError);
      await monque.initialize();
      // Count only runtime renewals, excluding initialization normalization/recovery.
      vi.mocked(mockCollection.updateMany).mockClear();
      monque.start();
      const stopping = monque.stop();

      stream.emit("error", new Error("The old cursor is closing"));
      closing.resolve();
      await stopping;

      expect(onStreamError).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

    it.each([undefined, 3000])(
      "keeps restarted timers and stream delivery when the previous stream finishes closing (lease: %s)",
      async (leaseDuration) => {
        monque = new Monque(mockDb, {
          heartbeatInterval: 1000,
          ...(leaseDuration === undefined ? {} : { leaseDuration }),
        });
        const closing = Promise.withResolvers<void>();
        const oldStream = createStream(closing.promise);
        const newStream = createStream();
        Object.assign(mockCollection, {
          options: vi.fn().mockResolvedValue({}),
          watch: vi.fn().mockReturnValueOnce(oldStream).mockReturnValueOnce(newStream),
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
      monque = new Monque(mockDb, {
        workerConcurrency: 2,
        heartbeatInterval: 1000,
        leaseDuration: 3000,
        recoverStaleJobs: false,
        shutdownTimeout: 10000,
      });
      const closing = Promise.withResolvers<void>();
      const oldStream = createStream(closing.promise);
      const newStream = createStream();
      Object.assign(mockCollection, {
        watch: vi.fn().mockReturnValueOnce(oldStream).mockReturnValueOnce(newStream),
      });
      const oldStarted = Promise.withResolvers<void>();
      const newStarted = Promise.withResolvers<void>();
      const oldHandler = Promise.withResolvers<void>();
      const newHandler = Promise.withResolvers<void>();
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
          expect.objectContaining({ claimId: { $in: ["new-claim"] } }),
          expect.any(Array),
        );

      const nextStopping = monque.stop();
      await vi.advanceTimersByTimeAsync(1000);
      expect.soft(mockCollection.updateMany).toHaveBeenCalledTimes(3);
      newHandler.resolve();
      await vi.advanceTimersByTimeAsync(10000);
      await Promise.all([stopping, nextStopping]);
      expect.soft(newStream.close).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("keeps lease renewal for a restarted run that has already begun draining", async () => {
      monque = new Monque(mockDb, {
        workerConcurrency: 1,
        heartbeatInterval: 1000,
        leaseDuration: 3000,
        recoverStaleJobs: false,
        shutdownTimeout: 10000,
      });
      const closing = Promise.withResolvers<void>();
      const oldStream = createStream(closing.promise);
      const newStream = createStream();
      Object.assign(mockCollection, {
        watch: vi.fn().mockReturnValueOnce(oldStream).mockReturnValueOnce(newStream),
      });
      await monque.initialize();
      // Count only runtime renewals, excluding initialization normalization/recovery.
      vi.mocked(mockCollection.updateMany).mockClear();
      monque.start();
      let firstStopped = false;
      const firstStopping = monque.stop().then(() => {
        firstStopped = true;
      });

      const started = Promise.withResolvers<void>();
      const handler = Promise.withResolvers<void>();
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
      const secondStopping = monque.stop().then(() => {
        secondStopped = true;
      });
      closing.resolve();
      await vi.advanceTimersByTimeAsync(1000);

      expect.soft(firstStopped).toBe(true);
      expect(secondStopped).toBe(false);
      expect(monque.isHealthy()).toBe(false);
      expect.soft(mockCollection.updateMany).toHaveBeenCalledOnce();
      handler.resolve();
      await vi.advanceTimersByTimeAsync(10000);
      await Promise.all([firstStopping, secondStopping]);
      expect(oldStream.close).toHaveBeenCalledOnce();
      expect(newStream.close).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("reports only original incomplete jobs when shutdown times out after a restart", async () => {
      monque = new Monque(mockDb, {
        workerConcurrency: 2,
        heartbeatInterval: 1000,
        leaseDuration: 3000,
        recoverStaleJobs: false,
        shutdownTimeout: 2000,
      });
      const closing = Promise.withResolvers<void>();
      const oldStream = createStream(closing.promise);
      const newStream = createStream();
      Object.assign(mockCollection, {
        watch: vi.fn().mockReturnValueOnce(oldStream).mockReturnValueOnce(newStream),
      });
      const shutdownErrors: ShutdownTimeoutError[] = [];
      monque.on("job:error", ({ error }) => {
        if (error instanceof ShutdownTimeoutError) shutdownErrors.push(error);
      });
      const oldStarted = Promise.withResolvers<void>();
      const newStarted = Promise.withResolvers<void>();
      const oldHandler = Promise.withResolvers<void>();
      const newHandler = Promise.withResolvers<void>();
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

      expect(shutdownErrors).toHaveLength(1);
      expect(shutdownErrors[0]?.incompleteJobs).toEqual([oldJob]);
      expect(monque.isHealthy()).toBe(true);
      expect(newStream.close).not.toHaveBeenCalled();
      expect(mockCollection.updateMany).toHaveBeenCalledTimes(3);

      const nextStopping = monque.stop();
      oldHandler.resolve();
      newHandler.resolve();
      await vi.advanceTimersByTimeAsync(0);
      await nextStopping;
      expect(shutdownErrors).toHaveLength(1);
      expect(oldStream.close).toHaveBeenCalledOnce();
      expect(newStream.close).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    });

    it.each([undefined, 3000])(
      "resolves overlapping stops when their shared active handler finishes (lease: %s)",
      async (leaseDuration) => {
        monque = new Monque(mockDb, {
          workerConcurrency: 1,
          heartbeatInterval: 1000,
          ...(leaseDuration === undefined ? {} : { leaseDuration }),
          recoverStaleJobs: false,
          shutdownTimeout: 10000,
        });
        const firstClosing = Promise.withResolvers<void>();
        const secondClosing = Promise.withResolvers<void>();
        const firstStream = createStream(firstClosing.promise);
        const secondStream = createStream(secondClosing.promise);
        Object.assign(mockCollection, {
          watch: vi.fn().mockReturnValueOnce(firstStream).mockReturnValueOnce(secondStream),
        });
        const started = Promise.withResolvers<void>();
        const handler = Promise.withResolvers<void>();
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
        const firstStopping = monque.stop().then(() => {
          firstStopped = true;
        });
        monque.start();
        const secondStopping = monque.stop().then(() => {
          secondStopped = true;
        });
        firstClosing.resolve();
        secondClosing.resolve();
        await vi.advanceTimersByTimeAsync(1000);
        expect(firstStopped).toBe(false);
        expect(secondStopped).toBe(false);
        expect
          .soft(mockCollection.updateMany)
          .toHaveBeenCalledTimes(leaseDuration === undefined ? 0 : 1);

        handler.resolve();
        await vi.advanceTimersByTimeAsync(0);
        expect.soft(firstStopped).toBe(true);
        expect.soft(secondStopped).toBe(true);
        expect.soft(vi.getTimerCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(10000);
        await Promise.all([firstStopping, secondStopping]);
        expect(firstStream.close).toHaveBeenCalledOnce();
        expect(secondStream.close).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
      },
    );
  });

  describe("worker registration", () => {
    it("should throw WorkerRegistrationError on duplicate registration", () => {
      const handler = async () => {};
      monque.register("test-job", handler);

      expect(() => {
        monque.register("test-job", handler);
      }).toThrow(WorkerRegistrationError);
    });

    it("exposes replacement concurrency in the Queue View", async () => {
      const handler1 = async () => {};
      const handler2 = async () => {};

      monque.register("test-job", handler1);
      monque.register("test-job", handler2, { replace: true, concurrency: 3 });
      await monque.initialize();

      expect(await monque.getQueueViewSummaries()).toMatchObject([
        { name: "test-job", worker: { concurrency: 3, activeCount: 0 } },
      ]);
    });

    it("should reject invalid worker names", () => {
      const handler = async () => {};

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

      expect(await monque.getJob(job._id.toHexString())).toEqual(job);
      expect(mockCollection.findOne).toHaveBeenCalledWith({ _id: job._id });
    });

    it("returns null for invalid string IDs without querying MongoDB", async () => {
      expect(await monque.getJob("invalid-id")).toBeNull();
      expect(mockCollection.findOne).not.toHaveBeenCalled();
    });

    it.each([false, true])(
      "refreshes cached statistics after a mutation (failed: %s)",
      async (fail) => {
        const toArray = vi
          .fn()
          .mockResolvedValueOnce([{ statusCounts: [], avgDuration: [], total: [{ count: 1 }] }])
          .mockResolvedValueOnce([{ statusCounts: [], avgDuration: [], total: [{ count: 2 }] }]);
        vi.mocked(mockCollection.aggregate).mockReturnValue({ toArray } as unknown as ReturnType<
          typeof mockCollection.aggregate
        >);
        expect((await monque.getQueueStats()).total).toBe(1);
        expect((await monque.getQueueStats()).total).toBe(1);

        if (fail) {
          vi.mocked(mockCollection.updateMany).mockRejectedValueOnce(new Error("Partial write"));
          await expect(monque.cancelJobs({})).rejects.toThrow(ConnectionError);
        } else {
          await expect(monque.cancelJobs({})).resolves.toMatchObject({ count: 0 });
        }

        expect((await monque.getQueueStats()).total).toBe(2);
      },
    );
  });
});
