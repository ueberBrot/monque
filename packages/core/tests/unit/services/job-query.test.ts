import { it } from "@effect/vitest";
import { Clock, Deferred, Effect, Exit, Fiber, Result } from "effect";
import { TestClock } from "effect/testing";
/**
 * Unit tests for JobQueryService.
 *
 * Tests job lookup, offset listing, statistics, and Queue Views.
 * Uses mock SchedulerContext to test query building in isolation.
 */
import { ObjectId } from "mongodb";
import { afterEach, beforeEach, describe, expect, expectTypeOf, vi } from "vite-plus/test";

import type { QueueStats, QueueViewSummary, QueueViewWorkerSummary } from "@/jobs";
import { JobQueryService } from "@/scheduler/services/job-query.js";
import { AggregationTimeoutError, ConnectionError } from "@/shared";
import { createMockContext, createWorker, JobFactory } from "@tests/factories";

describe("JobQueryService", () => {
  let ctx: ReturnType<typeof createMockContext>;
  let queryService: JobQueryService;

  beforeEach(() => {
    ctx = createMockContext();
    queryService = new JobQueryService(ctx);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe("getJob", () => {
    it.effect("should throw ConnectionError when database operation fails", () =>
      Effect.gen(function* () {
        vi.spyOn(ctx.mockCollection, "findOne").mockRejectedValueOnce(
          new Error("Database connection lost"),
        );

        const failureResult1 = yield* Effect.result(queryService.getJob(new ObjectId()));
        expect(failureResult1._tag).toBe("Failure");
        if (Result.isSuccess(failureResult1)) throw new Error("Expected operation to fail");
        const error = failureResult1.failure;
        expect(error).toBeInstanceOf(ConnectionError);
        expect((error as ConnectionError).message).toMatch(/Failed to get job/);
      }),
    );

    it.effect("should wrap non-Error thrown values in ConnectionError", () =>
      Effect.gen(function* () {
        vi.spyOn(ctx.mockCollection, "findOne").mockRejectedValueOnce("String error");

        expect(yield* Effect.result(queryService.getJob(new ObjectId()))).toMatchObject({
          _tag: "Failure",
          failure: expect.any(ConnectionError),
        });
      }),
    );
  });

  describe("getJobs", () => {
    it.effect("should throw ConnectionError when database operation fails", () =>
      Effect.gen(function* () {
        const mockCursor = {
          sort: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          skip: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockRejectedValueOnce(new Error("Database timeout")),
        };

        vi.spyOn(ctx.mockCollection, "find").mockReturnValueOnce(
          mockCursor as unknown as ReturnType<typeof ctx.mockCollection.find>,
        );

        const failureResult1 = yield* Effect.result(queryService.getJobs());
        expect(failureResult1._tag).toBe("Failure");
        if (Result.isSuccess(failureResult1)) throw new Error("Expected operation to fail");
        const error = failureResult1.failure;
        expect(error).toBeInstanceOf(ConnectionError);
        expect((error as ConnectionError).message).toMatch(/Failed to query jobs/);
      }),
    );

    it.effect("should wrap non-Error thrown values in ConnectionError", () =>
      Effect.gen(function* () {
        const mockCursor = {
          sort: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          skip: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockRejectedValueOnce("Network failure"),
        };

        vi.spyOn(ctx.mockCollection, "find").mockReturnValueOnce(
          mockCursor as unknown as ReturnType<typeof ctx.mockCollection.find>,
        );

        expect(yield* Effect.result(queryService.getJobs())).toMatchObject({
          _tag: "Failure",
          failure: expect.any(ConnectionError),
        });
      }),
    );
  });

  describe("getQueueStats", () => {
    it.effect("should return queue statistics with status counts", () =>
      Effect.gen(function* () {
        const mockAggregateResult = [
          {
            statusCounts: [
              { _id: "pending", count: 5 },
              { _id: "processing", count: 2 },
              { _id: "completed", count: 10 },
              { _id: "failed", count: 1 },
              { _id: "cancelled", count: 0 },
            ],
            avgDuration: [{ avgMs: 150.5 }],
            total: [{ count: 18 }],
          },
        ];

        const mockAggregateCursor = {
          toArray: vi.fn().mockResolvedValueOnce(mockAggregateResult),
        };

        vi.spyOn(ctx.mockCollection, "aggregate").mockReturnValueOnce(
          mockAggregateCursor as unknown as ReturnType<typeof ctx.mockCollection.aggregate>,
        );

        const stats = yield* queryService.getQueueStats();

        expect(stats.pending).toBe(5);
        expect(stats.processing).toBe(2);
        expect(stats.completed).toBe(10);
        expect(stats.failed).toBe(1);
        expect(stats.cancelled).toBe(0);
        expect(stats.total).toBe(18);
        expect(stats.avgProcessingDurationMs).toBe(151); // Rounded from 150.5
      }),
    );

    it.effect("should return empty stats when aggregation result is undefined", () =>
      Effect.gen(function* () {
        // Edge case: aggregation returns empty array (no first result)
        const mockAggregateCursor = {
          toArray: vi.fn().mockResolvedValueOnce([]),
        };

        vi.spyOn(ctx.mockCollection, "aggregate").mockReturnValueOnce(
          mockAggregateCursor as unknown as ReturnType<typeof ctx.mockCollection.aggregate>,
        );

        const stats = yield* queryService.getQueueStats();

        expect(stats.pending).toBe(0);
        expect(stats.processing).toBe(0);
        expect(stats.completed).toBe(0);
        expect(stats.failed).toBe(0);
        expect(stats.cancelled).toBe(0);
        expect(stats.total).toBe(0);
        expect(stats.avgProcessingDurationMs).toBeUndefined();
      }),
    );

    it.effect("should apply name filter when provided", () =>
      Effect.gen(function* () {
        const mockAggregateCursor = {
          toArray: vi.fn().mockResolvedValueOnce([
            {
              statusCounts: [],
              avgDuration: [],
              total: [{ count: 0 }],
            },
          ]),
        };

        vi.spyOn(ctx.mockCollection, "aggregate").mockReturnValueOnce(
          mockAggregateCursor as unknown as ReturnType<typeof ctx.mockCollection.aggregate>,
        );

        yield* queryService.getQueueStats({ name: "email-job" });

        expect(ctx.mockCollection.aggregate).toHaveBeenCalledWith(
          expect.arrayContaining([expect.objectContaining({ $match: { name: "email-job" } })]),
          { maxTimeMS: 30000 },
        );
      }),
    );

    it.effect("should throw AggregationTimeoutError when aggregation exceeds timeout", () =>
      Effect.gen(function* () {
        const timeoutError = Object.assign(new Error("max time expired"), { code: 50 });
        const mockAggregateCursor = {
          toArray: vi.fn().mockRejectedValueOnce(timeoutError),
        };

        vi.spyOn(ctx.mockCollection, "aggregate").mockReturnValueOnce(
          mockAggregateCursor as unknown as ReturnType<typeof ctx.mockCollection.aggregate>,
        );

        expect(yield* Effect.result(queryService.getQueueStats())).toMatchObject({
          _tag: "Failure",
          failure: expect.any(AggregationTimeoutError),
        });
      }),
    );

    it.effect("should throw AggregationTimeoutError when write concern reports timeout code", () =>
      Effect.gen(function* () {
        const timeoutError = Object.assign(new Error("write concern timeout"), {
          writeConcernError: { code: 50 },
        });
        const mockAggregateCursor = {
          toArray: vi.fn().mockRejectedValueOnce(timeoutError),
        };

        vi.spyOn(ctx.mockCollection, "aggregate").mockReturnValueOnce(
          mockAggregateCursor as unknown as ReturnType<typeof ctx.mockCollection.aggregate>,
        );

        expect(yield* Effect.result(queryService.getQueueStats())).toMatchObject({
          _tag: "Failure",
          failure: expect.any(AggregationTimeoutError),
        });
      }),
    );

    it.effect("should throw ConnectionError when aggregation fails with other errors", () =>
      Effect.gen(function* () {
        const mockAggregateCursor = {
          toArray: vi.fn().mockRejectedValueOnce(new Error("Database connection lost")),
        };

        vi.spyOn(ctx.mockCollection, "aggregate").mockReturnValueOnce(
          mockAggregateCursor as unknown as ReturnType<typeof ctx.mockCollection.aggregate>,
        );

        const failureResult1 = yield* Effect.result(queryService.getQueueStats());
        expect(failureResult1._tag).toBe("Failure");
        if (Result.isSuccess(failureResult1)) throw new Error("Expected operation to fail");
        const error = failureResult1.failure;
        expect(error).toBeInstanceOf(ConnectionError);
        expect((error as ConnectionError).message).toMatch(/Failed to get queue stats/);
      }),
    );

    it.effect("should wrap non-Error thrown values in ConnectionError", () =>
      Effect.gen(function* () {
        const mockAggregateCursor = {
          toArray: vi.fn().mockRejectedValueOnce("Network failure"),
        };

        vi.spyOn(ctx.mockCollection, "aggregate").mockReturnValueOnce(
          mockAggregateCursor as unknown as ReturnType<typeof ctx.mockCollection.aggregate>,
        );

        expect(yield* Effect.result(queryService.getQueueStats())).toMatchObject({
          _tag: "Failure",
          failure: expect.any(ConnectionError),
        });
      }),
    );

    it.effect("should handle empty avgDuration result gracefully", () =>
      Effect.gen(function* () {
        const mockAggregateResult = [
          {
            statusCounts: [{ _id: "pending", count: 3 }],
            avgDuration: [], // No completed jobs
            total: [{ count: 3 }],
          },
        ];

        const mockAggregateCursor = {
          toArray: vi.fn().mockResolvedValueOnce(mockAggregateResult),
        };

        vi.spyOn(ctx.mockCollection, "aggregate").mockReturnValueOnce(
          mockAggregateCursor as unknown as ReturnType<typeof ctx.mockCollection.aggregate>,
        );

        const stats = yield* queryService.getQueueStats();

        expect(stats.pending).toBe(3);
        expect(stats.total).toBe(3);
        expect(stats.avgProcessingDurationMs).toBeUndefined();
      }),
    );

    it.effect("should handle NaN avgMs gracefully", () =>
      Effect.gen(function* () {
        const mockAggregateResult = [
          {
            statusCounts: [],
            avgDuration: [{ avgMs: Number.NaN }],
            total: [{ count: 0 }],
          },
        ];

        const mockAggregateCursor = {
          toArray: vi.fn().mockResolvedValueOnce(mockAggregateResult),
        };

        vi.spyOn(ctx.mockCollection, "aggregate").mockReturnValueOnce(
          mockAggregateCursor as unknown as ReturnType<typeof ctx.mockCollection.aggregate>,
        );

        const stats = yield* queryService.getQueueStats();
        expect(stats.avgProcessingDurationMs).toBeUndefined();
      }),
    );

    describe("getQueueStats caching", () => {
      function mockAggregateResult(stats: Partial<Record<string, number>>) {
        const statusCounts = Object.entries(stats)
          .filter(([key]) => key !== "total" && key !== "avgMs")
          .map(([_id, count]) => ({ _id, count }));

        const mockAggregateCursor = {
          toArray: vi.fn().mockResolvedValueOnce([
            {
              statusCounts,
              avgDuration: [],
              total: [{ count: stats["total"] ?? 0 }],
            },
          ]),
        };

        vi.spyOn(ctx.mockCollection, "aggregate").mockReturnValueOnce(
          mockAggregateCursor as unknown as ReturnType<typeof ctx.mockCollection.aggregate>,
        );
      }

      it.effect("interrupting a statistics waiter leaves the shared read alive", () =>
        Effect.gen(function* () {
          const pending = yield* Deferred.make<unknown[]>();
          const started = yield* Deferred.make<void>();
          const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
          vi.spyOn(ctx.mockCollection, "aggregate").mockReturnValueOnce({
            toArray: () =>
              runPromise(
                Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(pending))),
              ),
          } as unknown as ReturnType<typeof ctx.mockCollection.aggregate>);
          const first = yield* Effect.forkChild(queryService.getQueueStats());
          yield* Deferred.await(started);
          const second = yield* Effect.forkChild(queryService.getQueueStats(), {
            startImmediately: true,
          });
          yield* Fiber.interrupt(first);
          expect(Exit.hasInterrupts(yield* Fiber.await(first))).toBe(true);
          expect(ctx.mockCollection.aggregate).toHaveBeenCalledTimes(1);

          yield* Deferred.succeed(pending, [
            {
              statusCounts: [{ _id: "pending", count: 5 }],
              total: [{ count: 5 }],
              avgDuration: [],
            },
          ]);
          const result = yield* Fiber.join(second);
          const cached = yield* queryService.getQueueStats();
          expect(result.pending).toBe(5);
          expect(cached.pending).toBe(5);
          expect(result).not.toBe(cached);
          expect(ctx.mockCollection.aggregate).toHaveBeenCalledTimes(1);
        }),
      );

      it.effect("shares concurrent statistics reads without sharing mutable results", () =>
        Effect.gen(function* () {
          const pending = yield* Deferred.make<unknown[]>();
          const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
          vi.spyOn(ctx.mockCollection, "aggregate").mockReturnValueOnce({
            toArray: () => runPromise(Deferred.await(pending)),
          } as unknown as ReturnType<typeof ctx.mockCollection.aggregate>);
          const readers = yield* Effect.forEach(Array.from({ length: 10 }), () =>
            Effect.forkChild(queryService.getQueueStats(), { startImmediately: true }),
          );
          expect(ctx.mockCollection.aggregate).toHaveBeenCalledTimes(1);
          yield* Deferred.succeed(pending, [
            {
              statusCounts: [{ _id: "pending", count: 5 }],
              total: [{ count: 5 }],
              avgDuration: [],
            },
          ]);
          const results = yield* Effect.forEach(readers, Fiber.join);
          expect(results.every((result) => result.pending === 5)).toBe(true);
          expect(results[0]).not.toBe(results[1]);
        }),
      );

      it.effect("does not let an in-flight read repopulate an invalidated snapshot", () =>
        Effect.gen(function* () {
          const pending = yield* Deferred.make<unknown[]>();
          const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
          vi.spyOn(ctx.mockCollection, "aggregate").mockReturnValueOnce({
            toArray: () => runPromise(Deferred.await(pending)),
          } as unknown as ReturnType<typeof ctx.mockCollection.aggregate>);
          const oldRead = yield* Effect.forkChild(queryService.getQueueStats(), {
            startImmediately: true,
          });
          expect(ctx.mockCollection.aggregate).toHaveBeenCalledOnce();
          queryService.clearStatsCache();
          mockAggregateResult({ pending: 2, total: 2 });
          expect((yield* queryService.getQueueStats()).pending).toBe(2);
          yield* Deferred.succeed(pending, [
            {
              statusCounts: [{ _id: "pending", count: 1 }],
              total: [{ count: 1 }],
              avgDuration: [],
            },
          ]);
          expect((yield* Fiber.join(oldRead)).pending).toBe(1);
          expect((yield* queryService.getQueueStats()).pending).toBe(2);
          expect(ctx.mockCollection.aggregate).toHaveBeenCalledTimes(2);
        }),
      );

      it.effect("shares a failed read but retries the next request", () =>
        Effect.gen(function* () {
          const pending = yield* Deferred.make<unknown[], Error>();
          const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
          vi.spyOn(ctx.mockCollection, "aggregate").mockReturnValueOnce({
            toArray: () => runPromise(Deferred.await(pending)),
          } as unknown as ReturnType<typeof ctx.mockCollection.aggregate>);
          const first = yield* Effect.forkChild(queryService.getQueueStats(), {
            startImmediately: true,
          });
          const second = yield* Effect.forkChild(queryService.getQueueStats(), {
            startImmediately: true,
          });
          yield* Deferred.fail(pending, new Error("Unavailable"));
          const results = yield* Effect.forEach([first, second], Fiber.await);
          expect(results.every(Exit.isFailure)).toBe(true);
          for (const result of results) {
            expect(Exit.findError(result)).toMatchObject({
              _tag: "Success",
              success: expect.any(ConnectionError),
            });
          }
          mockAggregateResult({ pending: 3, total: 3 });
          expect((yield* queryService.getQueueStats()).pending).toBe(3);
          expect(ctx.mockCollection.aggregate).toHaveBeenCalledTimes(2);
        }),
      );

      it.effect("should return cached result on second call within TTL", () =>
        Effect.gen(function* () {
          mockAggregateResult({ pending: 5, total: 5 });

          const first = yield* queryService.getQueueStats();
          expect(ctx.mockCollection.aggregate).toHaveBeenCalledTimes(1);

          const second = yield* queryService.getQueueStats();
          expect(ctx.mockCollection.aggregate).toHaveBeenCalledTimes(1);

          expect(first.pending).toBe(5);
          expect(second.pending).toBe(5);
          expect(first.total).toBe(5);
          expect(second.total).toBe(5);
        }),
      );

      it.effect.each([-60_000, 0, 60_000])(
        "expires cached results after elapsed TTL when wall time shifts by %i ms",
        (shift) =>
          Effect.gen(function* () {
            const clock = yield* Clock.Clock;
            let offset = 0;
            yield* Effect.gen(function* () {
              ctx.options.statsCacheTtlMs = 50;
              mockAggregateResult({ pending: 5, total: 5 });

              const first = yield* queryService.getQueueStats();
              expect(first.pending).toBe(5);

              offset = shift;
              yield* TestClock.adjust(49);
              expect((yield* queryService.getQueueStats()).pending).toBe(5);
              expect(ctx.mockCollection.aggregate).toHaveBeenCalledTimes(1);
              yield* TestClock.adjust(1);

              mockAggregateResult({ pending: 10, total: 10 });
              const second = yield* queryService.getQueueStats();

              expect(second.pending).toBe(10);
              expect(ctx.mockCollection.aggregate).toHaveBeenCalledTimes(2);
            }).pipe(
              Effect.provideService(Clock.Clock, {
                ...clock,
                currentTimeMillis: Effect.map(clock.currentTimeMillis, (now) => now + offset),
                currentTimeMillisUnsafe: () => clock.currentTimeMillisUnsafe() + offset,
              }),
            );
          }),
      );

      it.effect("should cache per-filter (different name filters have separate entries)", () =>
        Effect.gen(function* () {
          mockAggregateResult({ pending: 3, total: 3 });
          yield* queryService.getQueueStats({ name: "job-a" });

          mockAggregateResult({ pending: 7, total: 7 });
          yield* queryService.getQueueStats({ name: "job-b" });

          expect(ctx.mockCollection.aggregate).toHaveBeenCalledTimes(2);

          const cachedA = yield* queryService.getQueueStats({ name: "job-a" });
          const cachedB = yield* queryService.getQueueStats({ name: "job-b" });

          expect(ctx.mockCollection.aggregate).toHaveBeenCalledTimes(2);
          expect(cachedA.pending).toBe(3);
          expect(cachedB.pending).toBe(7);
        }),
      );

      it.effect("should not cache when statsCacheTtlMs is 0", () =>
        Effect.gen(function* () {
          ctx.options.statsCacheTtlMs = 0;

          mockAggregateResult({ pending: 5, total: 5 });
          const first = yield* queryService.getQueueStats();

          mockAggregateResult({ pending: 10, total: 10 });
          const second = yield* queryService.getQueueStats();

          expect(ctx.mockCollection.aggregate).toHaveBeenCalledTimes(2);
          expect(first.pending).toBe(5);
          expect(second.pending).toBe(10);
        }),
      );

      it.effect("should separate unfiltered and filtered cache entries", () =>
        Effect.gen(function* () {
          mockAggregateResult({ pending: 20, total: 20 });
          yield* queryService.getQueueStats();

          mockAggregateResult({ pending: 5, total: 5 });
          yield* queryService.getQueueStats({ name: "specific" });

          expect(ctx.mockCollection.aggregate).toHaveBeenCalledTimes(2);

          const cachedUnfiltered = yield* queryService.getQueueStats();
          const cachedFiltered = yield* queryService.getQueueStats({ name: "specific" });

          expect(ctx.mockCollection.aggregate).toHaveBeenCalledTimes(2);
          expect(cachedUnfiltered.total).toBe(20);
          expect(cachedFiltered.total).toBe(5);
        }),
      );

      it.effect("should evict oldest entry when cache exceeds max size", () =>
        Effect.gen(function* () {
          ctx.options.statsCacheTtlMs = 60_000;

          // Fill cache with 101 entries (exceeds MAX_CACHE_SIZE of 100)
          for (let i = 0; i <= 100; i++) {
            mockAggregateResult({ pending: i, total: i });
            yield* queryService.getQueueStats({ name: `job-${i}` });
          }

          // job-0 was the first entry and should have been evicted
          vi.mocked(ctx.mockCollection.aggregate).mockClear();
          mockAggregateResult({ pending: 999, total: 999 });
          const evicted = yield* queryService.getQueueStats({ name: "job-0" });

          // Should have hit DB (cache miss — evicted)
          expect(ctx.mockCollection.aggregate).toHaveBeenCalledTimes(1);
          expect(evicted.pending).toBe(999);

          // Most recent entry should still be cached
          vi.mocked(ctx.mockCollection.aggregate).mockClear();
          const cached = yield* queryService.getQueueStats({ name: "job-100" });
          expect(ctx.mockCollection.aggregate).not.toHaveBeenCalled();
          expect(cached.pending).toBe(100);
        }),
      );

      it.effect("clearStatsCache should clear all cached entries", () =>
        Effect.gen(function* () {
          mockAggregateResult({ pending: 5, total: 5 });
          yield* queryService.getQueueStats();

          // Verify cached
          const cached = yield* queryService.getQueueStats();
          expect(ctx.mockCollection.aggregate).toHaveBeenCalledTimes(1);
          expect(cached.pending).toBe(5);

          queryService.clearStatsCache();

          mockAggregateResult({ pending: 99, total: 99 });
          const afterClear = yield* queryService.getQueueStats();

          expect(ctx.mockCollection.aggregate).toHaveBeenCalledTimes(2);
          expect(afterClear.pending).toBe(99);
        }),
      );
    });
  });

  describe("getQueueViewSummaries", () => {
    it("should expose readonly Queue View snapshots in the public contract", () => {
      type QueueViewNestedSnapshots = Pick<QueueViewSummary, "stats" | "worker">;

      expectTypeOf<QueueViewNestedSnapshots>().toEqualTypeOf<Readonly<QueueViewNestedSnapshots>>();
      expectTypeOf<QueueViewSummary["stats"]>().toEqualTypeOf<Readonly<QueueStats>>();
      expectTypeOf<
        QueueViewSummary["worker"]
      >().toEqualTypeOf<Readonly<QueueViewWorkerSummary> | null>();
    });

    it.effect("should return persisted job names sorted by name with statistics", () =>
      Effect.gen(function* () {
        const mockAggregateCursor = {
          toArray: vi.fn().mockResolvedValueOnce([
            {
              _id: "report-daily",
              pending: 1,
              processing: 0,
              completed: 0,
              failed: 0,
              cancelled: 0,
              total: 1,
              completedDurationTotal: 0,
              completedDurationCount: 0,
            },
            {
              _id: "email-send",
              pending: 2,
              processing: 0,
              completed: 0,
              failed: 0,
              cancelled: 0,
              total: 2,
              completedDurationTotal: 0,
              completedDurationCount: 0,
            },
          ]),
        };

        vi.spyOn(ctx.mockCollection, "aggregate").mockReturnValueOnce(
          mockAggregateCursor as unknown as ReturnType<typeof ctx.mockCollection.aggregate>,
        );

        const summaries = yield* queryService.getQueueViewSummaries();

        expect(ctx.mockCollection.aggregate).toHaveBeenCalledWith(expect.any(Array), {
          maxTimeMS: 30000,
        });
        expect(summaries.map((summary) => summary.name)).toEqual(["email-send", "report-daily"]);
        expect(summaries).toMatchObject([
          {
            name: "email-send",
            hasPersistedJobs: true,
            hasRegisteredWorker: false,
            stats: { pending: 2, total: 2 },
            worker: null,
          },
          {
            name: "report-daily",
            hasPersistedJobs: true,
            hasRegisteredWorker: false,
            stats: { pending: 1, total: 1 },
            worker: null,
          },
        ]);
      }),
    );

    it.effect("should include registered-worker-only job names with zero statistics", () =>
      Effect.gen(function* () {
        const mockAggregateCursor = {
          toArray: vi.fn().mockResolvedValueOnce([]),
        };

        vi.spyOn(ctx.mockCollection, "aggregate").mockReturnValueOnce(
          mockAggregateCursor as unknown as ReturnType<typeof ctx.mockCollection.aggregate>,
        );

        ctx.workers.set("image-resize", createWorker({ concurrency: 7 }));

        const summaries = yield* queryService.getQueueViewSummaries();

        expect(summaries).toMatchObject([
          {
            name: "image-resize",
            hasPersistedJobs: false,
            hasRegisteredWorker: true,
            stats: {
              pending: 0,
              processing: 0,
              completed: 0,
              failed: 0,
              cancelled: 0,
              total: 0,
            },
            worker: {
              concurrency: 7,
              activeCount: 0,
            },
          },
        ]);
      }),
    );

    it.effect("should return an empty immutable list when no jobs or workers exist", () =>
      Effect.gen(function* () {
        const mockAggregateCursor = {
          toArray: vi.fn().mockResolvedValueOnce([]),
        };

        vi.spyOn(ctx.mockCollection, "aggregate").mockReturnValueOnce(
          mockAggregateCursor as unknown as ReturnType<typeof ctx.mockCollection.aggregate>,
        );

        const summaries = yield* queryService.getQueueViewSummaries();

        expect(summaries).toEqual([]);
        expect(Object.isFrozen(summaries)).toBe(true);
      }),
    );

    it.effect("should include historical-only job names with completed duration averages", () =>
      Effect.gen(function* () {
        const mockAggregateCursor = {
          toArray: vi.fn().mockResolvedValueOnce([
            {
              _id: "archive-user",
              pending: 0,
              processing: 0,
              completed: 2,
              failed: 1,
              cancelled: 1,
              total: 4,
              completedDurationTotal: 5000,
              completedDurationCount: 2,
            },
          ]),
        };

        vi.spyOn(ctx.mockCollection, "aggregate").mockReturnValueOnce(
          mockAggregateCursor as unknown as ReturnType<typeof ctx.mockCollection.aggregate>,
        );

        const summaries = yield* queryService.getQueueViewSummaries();

        expect(summaries).toMatchObject([
          {
            name: "archive-user",
            hasPersistedJobs: true,
            hasRegisteredWorker: false,
            stats: {
              completed: 2,
              failed: 1,
              cancelled: 1,
              total: 4,
              avgProcessingDurationMs: 2500,
            },
            worker: null,
          },
        ]);
      }),
    );

    it.effect("should combine persisted jobs and registered workers with active counts", () =>
      Effect.gen(function* () {
        const activeJob = JobFactory.build({ name: "email-send" });
        const mockAggregateCursor = {
          toArray: vi.fn().mockResolvedValueOnce([
            {
              _id: "email-send",
              pending: 1,
              processing: 1,
              completed: 0,
              failed: 0,
              cancelled: 0,
              total: 2,
              completedDurationTotal: 0,
              completedDurationCount: 0,
            },
          ]),
        };

        vi.spyOn(ctx.mockCollection, "aggregate").mockReturnValueOnce(
          mockAggregateCursor as unknown as ReturnType<typeof ctx.mockCollection.aggregate>,
        );
        ctx.workers.set(
          "email-send",
          createWorker({
            concurrency: 3,
            activeJobs: new Map([[activeJob._id.toString(), activeJob]]),
          }),
        );

        const summaries = yield* queryService.getQueueViewSummaries();

        expect(summaries).toMatchObject([
          {
            name: "email-send",
            hasPersistedJobs: true,
            hasRegisteredWorker: true,
            stats: {
              pending: 1,
              processing: 1,
              total: 2,
            },
            worker: {
              concurrency: 3,
              activeCount: 1,
            },
          },
        ]);
      }),
    );

    it.effect(
      "should expose immutable public summaries without worker maps or active job ids",
      () =>
        Effect.gen(function* () {
          const activeJob = JobFactory.build({ name: "email-send" });
          const mockAggregateCursor = {
            toArray: vi.fn().mockResolvedValueOnce([
              {
                _id: "email-send",
                pending: 0,
                processing: 1,
                completed: 0,
                failed: 0,
                cancelled: 0,
                total: 1,
                completedDurationTotal: 0,
                completedDurationCount: 0,
              },
            ]),
          };

          vi.spyOn(ctx.mockCollection, "aggregate").mockReturnValueOnce(
            mockAggregateCursor as unknown as ReturnType<typeof ctx.mockCollection.aggregate>,
          );
          ctx.workers.set(
            "email-send",
            createWorker({
              concurrency: 3,
              activeJobs: new Map([[activeJob._id.toString(), activeJob]]),
            }),
          );

          const summaries = yield* queryService.getQueueViewSummaries();
          const summary = summaries[0];
          expect(summary).toBeDefined();
          if (!summary) {
            throw new Error("Expected Queue View summary");
          }

          expect(Object.isFrozen(summaries)).toBe(true);
          expect(Object.isFrozen(summary)).toBe(true);
          expect(Object.isFrozen(summary.stats)).toBe(true);
          expect(Object.isFrozen(summary.worker)).toBe(true);
          expect(Object.keys(summary.worker ?? {})).toEqual([
            "concurrency",
            "activeCount",
            "paused",
            "hasSchema",
            "maxRetries",
            "baseRetryInterval",
            "maxBackoffDelay",
          ]);
          expect(summary.worker).not.toHaveProperty("activeJobs");
          expect(summary.worker).not.toHaveProperty("activeJobIds");
        }),
    );

    it.effect("should throw ConnectionError when aggregation fails", () =>
      Effect.gen(function* () {
        const mockAggregateCursor = {
          toArray: vi.fn().mockRejectedValueOnce(new Error("Database connection lost")),
        };

        vi.spyOn(ctx.mockCollection, "aggregate").mockReturnValueOnce(
          mockAggregateCursor as unknown as ReturnType<typeof ctx.mockCollection.aggregate>,
        );

        const failureResult1 = yield* Effect.result(queryService.getQueueViewSummaries());
        expect(failureResult1._tag).toBe("Failure");
        if (Result.isSuccess(failureResult1)) throw new Error("Expected operation to fail");
        const error = failureResult1.failure;
        expect(error).toBeInstanceOf(ConnectionError);
        expect((error as ConnectionError).message).toMatch(/Failed to get queue view summaries/);
      }),
    );

    it.effect("should throw AggregationTimeoutError when aggregation exceeds timeout", () =>
      Effect.gen(function* () {
        const timeoutError = Object.assign(new Error("max time expired"), { code: 50 });
        const mockAggregateCursor = {
          toArray: vi.fn().mockRejectedValueOnce(timeoutError),
        };

        vi.spyOn(ctx.mockCollection, "aggregate").mockReturnValueOnce(
          mockAggregateCursor as unknown as ReturnType<typeof ctx.mockCollection.aggregate>,
        );

        expect(yield* Effect.result(queryService.getQueueViewSummaries())).toMatchObject({
          _tag: "Failure",
          failure: expect.any(AggregationTimeoutError),
        });
      }),
    );

    it.effect("should throw AggregationTimeoutError when write concern reports timeout code", () =>
      Effect.gen(function* () {
        const timeoutError = Object.assign(new Error("write concern timeout"), {
          writeConcernError: { code: 50 },
        });
        const mockAggregateCursor = {
          toArray: vi.fn().mockRejectedValueOnce(timeoutError),
        };

        vi.spyOn(ctx.mockCollection, "aggregate").mockReturnValueOnce(
          mockAggregateCursor as unknown as ReturnType<typeof ctx.mockCollection.aggregate>,
        );

        expect(yield* Effect.result(queryService.getQueueViewSummaries())).toMatchObject({
          _tag: "Failure",
          failure: expect.any(AggregationTimeoutError),
        });
      }),
    );
  });
});
