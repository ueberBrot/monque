import { it } from "@effect/vitest";
import { fromAny, fromPartial } from "@total-typescript/shoehorn";
import { Clock, Deferred, Effect, Exit, Fiber, Result } from "effect";
import { map as mapEffect, forEach as forEachEffect } from "effect/Effect";
import { TestClock } from "effect/testing";
import type { FindCursor } from "mongodb";
/**
 * Unit tests for JobQueryService.
 *
 * Tests job lookup, offset listing, statistics, and Queue Views.
 * Uses mock SchedulerContext to test query building in isolation.
 */
import { ObjectId } from "mongodb";
import { afterEach, beforeEach, describe, expect, vi } from "vite-plus/test";

import { JobQueryService } from "@/scheduler/services/job-query.js";
import { AggregationTimeoutError, ConnectionError } from "@/shared";
import { createMockContext, createWorker, JobFactory } from "@tests/factories";
import { clockWithWallTime } from "@tests/setup/clock.js";
import {
  anyMatcher,
  objectContainingMatcher,
  arrayContainingMatcher,
} from "@tests/setup/matchers.js";
import type { MockFunction } from "@tests/setup/mock-function.js";

describe(JobQueryService, () => {
  let ctx: ReturnType<typeof createMockContext>;

  const mockStatsResult = (stats: Partial<Record<string, number>>) => {
    const statusCounts = Object.entries(stats)
      .filter(([key]) => key !== "total" && key !== "avgMs")
      .map(([_id, count]) => ({ _id, count }));
    const mockAggregateCursor = {
      toArray: vi.fn<MockFunction<FindCursor["toArray"]>>().mockResolvedValueOnce([
        {
          statusCounts,
          avgDuration: [],
          total: [{ count: stats["total"] ?? 0 }],
        },
      ]),
    };
    vi.spyOn(ctx.mockCollection, "aggregate").mockReturnValueOnce(
      fromAny<ReturnType<typeof ctx.mockCollection.aggregate>, unknown>(mockAggregateCursor),
    );
  };
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
      Effect.gen(function* effectWorkflow1() {
        vi.spyOn(ctx.mockCollection, "findOne").mockRejectedValueOnce(
          new Error("Database connection lost"),
        );
        const failureResult1 = yield* Effect.result(queryService.getJob(new ObjectId()));
        expect(failureResult1._tag).toBe("Failure");
        if (Result.isSuccess(failureResult1)) {
          throw new Error("Expected operation to fail");
        }
        const error = failureResult1.failure;
        expect(error).toBeInstanceOf(ConnectionError);
        expect(error.message).toMatch(/Failed to get job/u);
      }),
    );
    it.effect("should wrap non-Error thrown values in ConnectionError", () =>
      Effect.gen(function* effectWorkflow2() {
        vi.spyOn(ctx.mockCollection, "findOne").mockRejectedValueOnce("String error");
        expect(yield* Effect.result(queryService.getJob(new ObjectId()))).toMatchObject({
          _tag: "Failure",
          failure: anyMatcher(ConnectionError),
        });
      }),
    );
  });
  describe("getJobs", () => {
    it.effect("should throw ConnectionError when database operation fails", () =>
      Effect.gen(function* effectWorkflow3() {
        const mockCursor = {
          sort: vi.fn<MockFunction<FindCursor["sort"]>>().mockReturnThis(),
          limit: vi.fn<MockFunction<FindCursor["limit"]>>().mockReturnThis(),
          skip: vi.fn<MockFunction<FindCursor["skip"]>>().mockReturnThis(),
          toArray: vi
            .fn<MockFunction<FindCursor["toArray"]>>()
            .mockRejectedValueOnce(new Error("Database timeout")),
        };
        vi.spyOn(ctx.mockCollection, "find").mockReturnValueOnce(
          fromAny<ReturnType<typeof ctx.mockCollection.find>, unknown>(mockCursor),
        );
        const failureResult1 = yield* Effect.result(queryService.getJobs());
        expect(failureResult1._tag).toBe("Failure");
        if (Result.isSuccess(failureResult1)) {
          throw new Error("Expected operation to fail");
        }
        const error = failureResult1.failure;
        expect(error).toBeInstanceOf(ConnectionError);
        expect(fromAny<ConnectionError, unknown>(error).message).toMatch(/Failed to query jobs/u);
      }),
    );
    it.effect("should wrap non-Error thrown values in ConnectionError", () =>
      Effect.gen(function* effectWorkflow4() {
        const mockCursor = {
          sort: vi.fn<MockFunction<FindCursor["sort"]>>().mockReturnThis(),
          limit: vi.fn<MockFunction<FindCursor["limit"]>>().mockReturnThis(),
          skip: vi.fn<MockFunction<FindCursor["skip"]>>().mockReturnThis(),
          toArray: vi
            .fn<MockFunction<FindCursor["toArray"]>>()
            .mockRejectedValueOnce("Network failure"),
        };
        vi.spyOn(ctx.mockCollection, "find").mockReturnValueOnce(
          fromAny<ReturnType<typeof ctx.mockCollection.find>, unknown>(mockCursor),
        );
        expect(yield* Effect.result(queryService.getJobs())).toMatchObject({
          _tag: "Failure",
          failure: anyMatcher(ConnectionError),
        });
      }),
    );
  });
  describe("getQueueStats", () => {
    it.effect("should return queue statistics with status counts", () =>
      Effect.gen(function* effectWorkflow5() {
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
          toArray: vi
            .fn<MockFunction<FindCursor["toArray"]>>()
            .mockResolvedValueOnce(mockAggregateResult),
        };

        vi.spyOn(ctx.mockCollection, "aggregate").mockReturnValueOnce(
          fromAny<ReturnType<typeof ctx.mockCollection.aggregate>, unknown>(mockAggregateCursor),
        );
        const stats = yield* queryService.getQueueStats();
        expect({
          statsPending: stats.pending,
          statsProcessing: stats.processing,
          statsCompleted: stats.completed,
          statsFailed: stats.failed,
          statsCancelled: stats.cancelled,
          statsTotal: stats.total,
          statsAvgProcessingDurationMs: stats.avgProcessingDurationMs,
        }).toStrictEqual({
          statsPending: 5,
          statsProcessing: 2,
          statsCompleted: 10,
          statsFailed: 1,
          statsCancelled: 0,
          statsTotal: 18,
          statsAvgProcessingDurationMs: 151,
        });
      }),
    );
    it.effect("should return empty stats when aggregation result is undefined", () =>
      Effect.gen(function* effectWorkflow6() {
        // Edge case: aggregation returns empty array (no first result)
        const mockAggregateCursor = {
          toArray: vi.fn<MockFunction<FindCursor["toArray"]>>().mockResolvedValueOnce([]),
        };
        vi.spyOn(ctx.mockCollection, "aggregate").mockReturnValueOnce(
          fromAny<ReturnType<typeof ctx.mockCollection.aggregate>, unknown>(mockAggregateCursor),
        );
        const stats = yield* queryService.getQueueStats();
        expect({
          statsPending: stats.pending,
          statsProcessing: stats.processing,
          statsCompleted: stats.completed,
          statsFailed: stats.failed,
          statsCancelled: stats.cancelled,
          statsTotal: stats.total,
          statsAvgProcessingDurationMs: stats.avgProcessingDurationMs,
        }).toStrictEqual({
          statsPending: 0,
          statsProcessing: 0,
          statsCompleted: 0,
          statsFailed: 0,
          statsCancelled: 0,
          statsTotal: 0,
          statsAvgProcessingDurationMs: undefined,
        });
      }),
    );
    it.effect("should apply name filter when provided", () =>
      Effect.gen(function* effectWorkflow7() {
        const mockAggregateCursor = {
          toArray: vi.fn<MockFunction<FindCursor["toArray"]>>().mockResolvedValueOnce([
            {
              statusCounts: [],
              avgDuration: [],
              total: [{ count: 0 }],
            },
          ]),
        };
        vi.spyOn(ctx.mockCollection, "aggregate").mockReturnValueOnce(
          fromAny<ReturnType<typeof ctx.mockCollection.aggregate>, unknown>(mockAggregateCursor),
        );
        yield* queryService.getQueueStats({ name: "email-job" });
        expect(ctx.mockCollection.aggregate).toHaveBeenCalledWith(
          arrayContainingMatcher([objectContainingMatcher({ $match: { name: "email-job" } })]),
          { maxTimeMS: 30_000 },
        );
      }),
    );
    it.effect("should throw AggregationTimeoutError when aggregation exceeds timeout", () =>
      Effect.gen(function* effectWorkflow8() {
        const timeoutError = Object.assign(new Error("max time expired"), { code: 50 });
        const mockAggregateCursor = {
          toArray: vi.fn<MockFunction<FindCursor["toArray"]>>().mockRejectedValueOnce(timeoutError),
        };
        vi.spyOn(ctx.mockCollection, "aggregate").mockReturnValueOnce(
          fromAny<ReturnType<typeof ctx.mockCollection.aggregate>, unknown>(mockAggregateCursor),
        );
        expect(yield* Effect.result(queryService.getQueueStats())).toMatchObject({
          _tag: "Failure",
          failure: anyMatcher(AggregationTimeoutError),
        });
      }),
    );
    it.effect("should throw AggregationTimeoutError when write concern reports timeout code", () =>
      Effect.gen(function* effectWorkflow9() {
        const timeoutError = Object.assign(new Error("write concern timeout"), {
          writeConcernError: { code: 50 },
        });
        const mockAggregateCursor = {
          toArray: vi.fn<MockFunction<FindCursor["toArray"]>>().mockRejectedValueOnce(timeoutError),
        };
        vi.spyOn(ctx.mockCollection, "aggregate").mockReturnValueOnce(
          fromAny<ReturnType<typeof ctx.mockCollection.aggregate>, unknown>(mockAggregateCursor),
        );
        expect(yield* Effect.result(queryService.getQueueStats())).toMatchObject({
          _tag: "Failure",
          failure: anyMatcher(AggregationTimeoutError),
        });
      }),
    );
    it.effect("should throw ConnectionError when aggregation fails with other errors", () =>
      Effect.gen(function* effectWorkflow10() {
        const mockAggregateCursor = {
          toArray: vi
            .fn<MockFunction<FindCursor["toArray"]>>()
            .mockRejectedValueOnce(new Error("Database connection lost")),
        };
        vi.spyOn(ctx.mockCollection, "aggregate").mockReturnValueOnce(
          fromAny<ReturnType<typeof ctx.mockCollection.aggregate>, unknown>(mockAggregateCursor),
        );
        const failureResult1 = yield* Effect.result(queryService.getQueueStats());
        expect(failureResult1._tag).toBe("Failure");
        if (Result.isSuccess(failureResult1)) {
          throw new Error("Expected operation to fail");
        }
        const error = failureResult1.failure;
        expect(error).toBeInstanceOf(ConnectionError);
        expect(fromAny<ConnectionError, unknown>(error).message).toMatch(
          /Failed to get queue stats/u,
        );
      }),
    );
    it.effect("should wrap non-Error thrown values in ConnectionError", () =>
      Effect.gen(function* effectWorkflow11() {
        const mockAggregateCursor = {
          toArray: vi
            .fn<MockFunction<FindCursor["toArray"]>>()
            .mockRejectedValueOnce("Network failure"),
        };
        vi.spyOn(ctx.mockCollection, "aggregate").mockReturnValueOnce(
          fromAny<ReturnType<typeof ctx.mockCollection.aggregate>, unknown>(mockAggregateCursor),
        );
        expect(yield* Effect.result(queryService.getQueueStats())).toMatchObject({
          _tag: "Failure",
          failure: anyMatcher(ConnectionError),
        });
      }),
    );
    it.effect("should handle empty avgDuration result gracefully", () =>
      Effect.gen(function* effectWorkflow12() {
        const mockAggregateResult = [
          {
            statusCounts: [{ _id: "pending", count: 3 }],
            // No completed jobs
            avgDuration: [],
            total: [{ count: 3 }],
          },
        ];
        const mockAggregateCursor = {
          toArray: vi
            .fn<MockFunction<FindCursor["toArray"]>>()
            .mockResolvedValueOnce(mockAggregateResult),
        };
        vi.spyOn(ctx.mockCollection, "aggregate").mockReturnValueOnce(
          fromAny<ReturnType<typeof ctx.mockCollection.aggregate>, unknown>(mockAggregateCursor),
        );
        const stats = yield* queryService.getQueueStats();
        expect({
          statsPending: stats.pending,
          statsTotal: stats.total,
          statsAvgProcessingDurationMs: stats.avgProcessingDurationMs,
        }).toStrictEqual({
          statsPending: 3,
          statsTotal: 3,
          statsAvgProcessingDurationMs: undefined,
        });
      }),
    );
    it.effect("should handle NaN avgMs gracefully", () =>
      Effect.gen(function* effectWorkflow13() {
        const mockAggregateResult = [
          {
            statusCounts: [],
            avgDuration: [{ avgMs: Number.NaN }],
            total: [{ count: 0 }],
          },
        ];
        const mockAggregateCursor = {
          toArray: vi
            .fn<MockFunction<FindCursor["toArray"]>>()
            .mockResolvedValueOnce(mockAggregateResult),
        };
        vi.spyOn(ctx.mockCollection, "aggregate").mockReturnValueOnce(
          fromAny<ReturnType<typeof ctx.mockCollection.aggregate>, unknown>(mockAggregateCursor),
        );
        const stats = yield* queryService.getQueueStats();
        expect(stats.avgProcessingDurationMs).toBeUndefined();
      }),
    );
    describe("getQueueStats caching", () => {
      it.effect("interrupting a statistics waiter leaves the shared read alive", () =>
        Effect.gen(function* effectWorkflow14() {
          const pending = yield* Deferred.make<unknown[]>();
          const started = yield* Deferred.make<Effect.Success<typeof Effect.void>>();
          const runPromise = Effect.runPromiseWith(yield* Effect.context());
          vi.spyOn(ctx.mockCollection, "aggregate").mockReturnValueOnce(
            fromPartial<ReturnType<typeof ctx.mockCollection.aggregate>>({
              toArray: async () =>
                await runPromise(
                  Deferred.succeed(started, undefined).pipe(
                    Effect.andThen(Deferred.await(pending)),
                  ),
                ),
            }),
          );
          const first = yield* Effect.forkChild(queryService.getQueueStats());
          yield* Deferred.await(started);
          const second = yield* Effect.forkChild(queryService.getQueueStats(), {
            startImmediately: true,
          });
          yield* Fiber.interrupt(first);
          expect({
            exitHasInterruptsFiberFirst: Exit.hasInterrupts(yield* Fiber.await(first)),
            mockCollectionAggregateMockCallsLength: ctx.mockCollection.aggregate.mock.calls.length,
          }).toStrictEqual({
            exitHasInterruptsFiberFirst: true,
            mockCollectionAggregateMockCallsLength: 1,
          });
          yield* Deferred.succeed(pending, [
            {
              statusCounts: [{ _id: "pending", count: 5 }],
              total: [{ count: 5 }],
              avgDuration: [],
            },
          ]);
          const result = yield* Fiber.join(second);
          const cached = yield* queryService.getQueueStats();
          expect({
            resultPending: result.pending,
            cachedPending: cached.pending,
          }).toStrictEqual({
            resultPending: 5,
            cachedPending: 5,
          });
          expect(result).not.toBe(cached);
          expect(ctx.mockCollection.aggregate).toHaveBeenCalledOnce();
        }),
      );
      it.effect("shares concurrent statistics reads without sharing mutable results", () =>
        Effect.gen(function* effectWorkflow15() {
          const pending = yield* Deferred.make<unknown[]>();
          const runPromise = Effect.runPromiseWith(yield* Effect.context());
          vi.spyOn(ctx.mockCollection, "aggregate").mockReturnValueOnce(
            fromPartial<ReturnType<typeof ctx.mockCollection.aggregate>>({
              toArray: async () => await runPromise(Deferred.await(pending)),
            }),
          );
          const readers = yield* forEachEffect(Array.from({ length: 10 }), () =>
            Effect.forkChild(queryService.getQueueStats(), { startImmediately: true }),
          );
          expect(ctx.mockCollection.aggregate).toHaveBeenCalledOnce();
          yield* Deferred.succeed(pending, [
            {
              statusCounts: [{ _id: "pending", count: 5 }],
              total: [{ count: 5 }],
              avgDuration: [],
            },
          ]);
          const results = yield* forEachEffect(readers, Fiber.join);
          expect(results.every((result) => result.pending === 5)).toBe(true);
          expect(results[0]).not.toBe(results[1]);
        }),
      );
      it.effect("does not let an in-flight read repopulate an invalidated snapshot", () =>
        Effect.gen(function* effectWorkflow16() {
          const pending = yield* Deferred.make<unknown[]>();
          const runPromise = Effect.runPromiseWith(yield* Effect.context());
          vi.spyOn(ctx.mockCollection, "aggregate").mockReturnValueOnce(
            fromPartial<ReturnType<typeof ctx.mockCollection.aggregate>>({
              toArray: async () => await runPromise(Deferred.await(pending)),
            }),
          );
          const oldRead = yield* Effect.forkChild(queryService.getQueueStats(), {
            startImmediately: true,
          });
          expect(ctx.mockCollection.aggregate).toHaveBeenCalledOnce();
          queryService.clearStatsCache();
          mockStatsResult({ pending: 2, total: 2 });
          expect((yield* queryService.getQueueStats()).pending).toBe(2);
          yield* Deferred.succeed(pending, [
            {
              statusCounts: [{ _id: "pending", count: 1 }],
              total: [{ count: 1 }],
              avgDuration: [],
            },
          ]);
          expect({
            fiberJoinOldReadPending: (yield* Fiber.join(oldRead)).pending,
            queryServiceGetQueueStatsPending: (yield* queryService.getQueueStats()).pending,
            mockCollectionAggregateMockCallsLength: ctx.mockCollection.aggregate.mock.calls.length,
          }).toStrictEqual({
            fiberJoinOldReadPending: 1,
            queryServiceGetQueueStatsPending: 2,
            mockCollectionAggregateMockCallsLength: 2,
          });
        }),
      );
      it.effect("shares a failed read but retries the next request", () =>
        Effect.gen(function* effectWorkflow17() {
          const pending = yield* Deferred.make<unknown[], Error>();
          const runPromise = Effect.runPromiseWith(yield* Effect.context());
          vi.spyOn(ctx.mockCollection, "aggregate").mockReturnValueOnce(
            fromPartial<ReturnType<typeof ctx.mockCollection.aggregate>>({
              toArray: async () => await runPromise(Deferred.await(pending)),
            }),
          );
          const first = yield* Effect.forkChild(queryService.getQueueStats(), {
            startImmediately: true,
          });
          const second = yield* Effect.forkChild(queryService.getQueueStats(), {
            startImmediately: true,
          });
          yield* Deferred.fail(pending, new Error("Unavailable"));
          const results = yield* forEachEffect([first, second], Fiber.await);
          expect(results.every(Exit.isFailure)).toBe(true);
          for (const result of results) {
            expect(Exit.findError(result)).toMatchObject({
              _tag: "Success",
              success: anyMatcher(ConnectionError),
            });
          }
          mockStatsResult({ pending: 3, total: 3 });
          expect({
            queryServiceGetQueueStatsPending: (yield* queryService.getQueueStats()).pending,
            mockCollectionAggregateMockCallsLength: ctx.mockCollection.aggregate.mock.calls.length,
          }).toStrictEqual({
            queryServiceGetQueueStatsPending: 3,
            mockCollectionAggregateMockCallsLength: 2,
          });
        }),
      );
      it.effect("should return cached result on second call within TTL", () =>
        Effect.gen(function* effectWorkflow18() {
          mockStatsResult({ pending: 5, total: 5 });
          const first = yield* queryService.getQueueStats();
          expect(ctx.mockCollection.aggregate).toHaveBeenCalledOnce();
          const second = yield* queryService.getQueueStats();
          expect({
            mockCollectionAggregateMockCallsLength: ctx.mockCollection.aggregate.mock.calls.length,
            firstPending: first.pending,
            secondPending: second.pending,
            firstTotal: first.total,
            secondTotal: second.total,
          }).toStrictEqual({
            mockCollectionAggregateMockCallsLength: 1,
            firstPending: 5,
            secondPending: 5,
            firstTotal: 5,
            secondTotal: 5,
          });
        }),
      );
      it.effect.each([-60_000, 0, 60_000])(
        "expires cached results after elapsed TTL when wall time shifts by %i ms",
        (shift) =>
          Effect.gen(function* effectWorkflow19() {
            const testClock = yield* TestClock.testClockWith(Effect.succeed);
            const clock = yield* Clock.Clock;
            let offset = 0;
            yield* Effect.gen(function* effectWorkflow20() {
              ctx.options.statsCacheTtlMs = 50;
              mockStatsResult({ pending: 5, total: 5 });
              const first = yield* queryService.getQueueStats();
              expect(first.pending).toBe(5);
              offset = shift;
              yield* testClock.adjust(49);
              expect({
                queryServiceGetQueueStatsPending: (yield* queryService.getQueueStats()).pending,
                mockCollectionAggregateMockCallsLength:
                  ctx.mockCollection.aggregate.mock.calls.length,
              }).toStrictEqual({
                queryServiceGetQueueStatsPending: 5,
                mockCollectionAggregateMockCallsLength: 1,
              });
              yield* testClock.adjust(1);
              mockStatsResult({ pending: 10, total: 10 });
              const second = yield* queryService.getQueueStats();
              expect({
                secondPending: second.pending,
                mockCollectionAggregateMockCallsLength:
                  ctx.mockCollection.aggregate.mock.calls.length,
              }).toStrictEqual({
                secondPending: 10,
                mockCollectionAggregateMockCallsLength: 2,
              });
            }).pipe(
              Effect.provideService(
                Clock.Clock,
                clockWithWallTime(
                  clock,
                  mapEffect(clock.currentTimeMillis, (now) => now + offset),
                  () => clock.currentTimeMillisUnsafe() + offset,
                ),
              ),
            );
          }),
      );
      it.effect("should cache per-filter (different name filters have separate entries)", () =>
        Effect.gen(function* effectWorkflow21() {
          mockStatsResult({ pending: 3, total: 3 });
          yield* queryService.getQueueStats({ name: "job-a" });
          mockStatsResult({ pending: 7, total: 7 });
          yield* queryService.getQueueStats({ name: "job-b" });
          expect(ctx.mockCollection.aggregate).toHaveBeenCalledTimes(2);
          const cachedA = yield* queryService.getQueueStats({ name: "job-a" });
          const cachedB = yield* queryService.getQueueStats({ name: "job-b" });
          expect({
            mockCollectionAggregateMockCallsLength: ctx.mockCollection.aggregate.mock.calls.length,
            cachedAPending: cachedA.pending,
            cachedBPending: cachedB.pending,
          }).toStrictEqual({
            mockCollectionAggregateMockCallsLength: 2,
            cachedAPending: 3,
            cachedBPending: 7,
          });
        }),
      );
      it.effect("should not cache when statsCacheTtlMs is 0", () =>
        Effect.gen(function* effectWorkflow22() {
          ctx.options.statsCacheTtlMs = 0;
          mockStatsResult({ pending: 5, total: 5 });
          const first = yield* queryService.getQueueStats();
          mockStatsResult({ pending: 10, total: 10 });
          const second = yield* queryService.getQueueStats();
          expect({
            mockCollectionAggregateMockCallsLength: ctx.mockCollection.aggregate.mock.calls.length,
            firstPending: first.pending,
            secondPending: second.pending,
          }).toStrictEqual({
            mockCollectionAggregateMockCallsLength: 2,
            firstPending: 5,
            secondPending: 10,
          });
        }),
      );
      it.effect("should separate unfiltered and filtered cache entries", () =>
        Effect.gen(function* effectWorkflow23() {
          mockStatsResult({ pending: 20, total: 20 });
          yield* queryService.getQueueStats();
          mockStatsResult({ pending: 5, total: 5 });
          yield* queryService.getQueueStats({ name: "specific" });
          expect(ctx.mockCollection.aggregate).toHaveBeenCalledTimes(2);
          const cachedUnfiltered = yield* queryService.getQueueStats();
          const cachedFiltered = yield* queryService.getQueueStats({ name: "specific" });
          expect({
            mockCollectionAggregateMockCallsLength: ctx.mockCollection.aggregate.mock.calls.length,
            cachedUnfilteredTotal: cachedUnfiltered.total,
            cachedFilteredTotal: cachedFiltered.total,
          }).toStrictEqual({
            mockCollectionAggregateMockCallsLength: 2,
            cachedUnfilteredTotal: 20,
            cachedFilteredTotal: 5,
          });
        }),
      );
      it.effect("should evict oldest entry when cache exceeds max size", () =>
        Effect.gen(function* effectWorkflow24() {
          ctx.options.statsCacheTtlMs = 60_000;
          // Fill cache with 101 entries (exceeds MAX_CACHE_SIZE of 100)
          for (let i = 0; i <= 100; i += 1) {
            mockStatsResult({ pending: i, total: i });
            yield* queryService.getQueueStats({ name: `job-${i}` });
          }
          // job-0 was the first entry and should have been evicted
          vi.mocked(ctx.mockCollection.aggregate).mockClear();
          mockStatsResult({ pending: 999, total: 999 });
          const evicted = yield* queryService.getQueueStats({ name: "job-0" });
          // Should have hit DB (cache miss — evicted)
          expect({
            mockCollectionAggregateMockCallsLength: ctx.mockCollection.aggregate.mock.calls.length,
            evictedPending: evicted.pending,
          }).toStrictEqual({
            mockCollectionAggregateMockCallsLength: 1,
            evictedPending: 999,
          });
          // Most recent entry should still be cached
          vi.mocked(ctx.mockCollection.aggregate).mockClear();
          const cached = yield* queryService.getQueueStats({ name: "job-100" });
          expect({
            mockCollectionAggregateMockCallsLength: ctx.mockCollection.aggregate.mock.calls.length,
            cachedPending: cached.pending,
          }).toStrictEqual({
            mockCollectionAggregateMockCallsLength: 0,
            cachedPending: 100,
          });
        }),
      );
      it.effect("clearStatsCache should clear all cached entries", () =>
        Effect.gen(function* effectWorkflow25() {
          mockStatsResult({ pending: 5, total: 5 });
          yield* queryService.getQueueStats();
          // Verify cached
          const cached = yield* queryService.getQueueStats();
          expect({
            mockCollectionAggregateMockCallsLength: ctx.mockCollection.aggregate.mock.calls.length,
            cachedPending: cached.pending,
          }).toStrictEqual({
            mockCollectionAggregateMockCallsLength: 1,
            cachedPending: 5,
          });
          queryService.clearStatsCache();
          mockStatsResult({ pending: 99, total: 99 });
          const afterClear = yield* queryService.getQueueStats();
          expect({
            mockCollectionAggregateMockCallsLength: ctx.mockCollection.aggregate.mock.calls.length,
            afterClearPending: afterClear.pending,
          }).toStrictEqual({
            mockCollectionAggregateMockCallsLength: 2,
            afterClearPending: 99,
          });
        }),
      );
    });
  });
  describe("getQueueViewSummaries", () => {
    it.effect("should return persisted job names sorted by name with statistics", () =>
      Effect.gen(function* effectWorkflow26() {
        const mockAggregateCursor = {
          toArray: vi.fn<MockFunction<FindCursor["toArray"]>>().mockResolvedValueOnce([
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
          fromAny<ReturnType<typeof ctx.mockCollection.aggregate>, unknown>(mockAggregateCursor),
        );
        const summaries = yield* queryService.getQueueViewSummaries();
        expect(ctx.mockCollection.aggregate).toHaveBeenCalledWith(anyMatcher(Array), {
          maxTimeMS: 30_000,
        });
        expect(summaries.map((summary) => summary.name)).toStrictEqual([
          "email-send",
          "report-daily",
        ]);
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
      Effect.gen(function* effectWorkflow27() {
        const mockAggregateCursor = {
          toArray: vi.fn<MockFunction<FindCursor["toArray"]>>().mockResolvedValueOnce([]),
        };
        vi.spyOn(ctx.mockCollection, "aggregate").mockReturnValueOnce(
          fromAny<ReturnType<typeof ctx.mockCollection.aggregate>, unknown>(mockAggregateCursor),
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
      Effect.gen(function* effectWorkflow28() {
        const mockAggregateCursor = {
          toArray: vi.fn<MockFunction<FindCursor["toArray"]>>().mockResolvedValueOnce([]),
        };
        vi.spyOn(ctx.mockCollection, "aggregate").mockReturnValueOnce(
          fromAny<ReturnType<typeof ctx.mockCollection.aggregate>, unknown>(mockAggregateCursor),
        );
        const summaries = yield* queryService.getQueueViewSummaries();
        expect({
          summaries,
          objectIsFrozenSummaries: Object.isFrozen(summaries),
        }).toStrictEqual({
          summaries: [],
          objectIsFrozenSummaries: true,
        });
      }),
    );
    it.effect("should include historical-only job names with completed duration averages", () =>
      Effect.gen(function* effectWorkflow29() {
        const mockAggregateCursor = {
          toArray: vi.fn<MockFunction<FindCursor["toArray"]>>().mockResolvedValueOnce([
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
          fromAny<ReturnType<typeof ctx.mockCollection.aggregate>, unknown>(mockAggregateCursor),
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
      Effect.gen(function* effectWorkflow30() {
        const activeJob = JobFactory.build({ name: "email-send" });
        const mockAggregateCursor = {
          toArray: vi.fn<MockFunction<FindCursor["toArray"]>>().mockResolvedValueOnce([
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
          fromAny<ReturnType<typeof ctx.mockCollection.aggregate>, unknown>(mockAggregateCursor),
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
        Effect.gen(function* effectWorkflow31() {
          const activeJob = JobFactory.build({ name: "email-send" });
          const mockAggregateCursor = {
            toArray: vi.fn<MockFunction<FindCursor["toArray"]>>().mockResolvedValueOnce([
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
            fromAny<ReturnType<typeof ctx.mockCollection.aggregate>, unknown>(mockAggregateCursor),
          );
          ctx.workers.set(
            "email-send",
            createWorker({
              concurrency: 3,
              activeJobs: new Map([[activeJob._id.toString(), activeJob]]),
            }),
          );
          const summaries = yield* queryService.getQueueViewSummaries();
          const [summary] = summaries;
          expect(summary).toBeDefined();
          if (!summary) {
            throw new Error("Expected Queue View summary");
          }
          expect({
            objectIsFrozenSummaries: Object.isFrozen(summaries),
            objectIsFrozenSummary: Object.isFrozen(summary),
            objectIsFrozenSummaryStats: Object.isFrozen(summary.stats),
            objectIsFrozenSummaryWorker: Object.isFrozen(summary.worker),
            objectKeysSummaryWorker: Object.keys(summary.worker ?? {}),
          }).toStrictEqual({
            objectIsFrozenSummaries: true,
            objectIsFrozenSummary: true,
            objectIsFrozenSummaryStats: true,
            objectIsFrozenSummaryWorker: true,
            objectKeysSummaryWorker: [
              "concurrency",
              "activeCount",
              "paused",
              "hasSchema",
              "maxRetries",
              "baseRetryInterval",
              "maxBackoffDelay",
            ],
          });
          expect(summary.worker).not.toHaveProperty("activeJobs");
          expect(summary.worker).not.toHaveProperty("activeJobIds");
        }),
    );
    it.effect("should throw ConnectionError when aggregation fails", () =>
      Effect.gen(function* effectWorkflow32() {
        const mockAggregateCursor = {
          toArray: vi
            .fn<MockFunction<FindCursor["toArray"]>>()
            .mockRejectedValueOnce(new Error("Database connection lost")),
        };
        vi.spyOn(ctx.mockCollection, "aggregate").mockReturnValueOnce(
          fromAny<ReturnType<typeof ctx.mockCollection.aggregate>, unknown>(mockAggregateCursor),
        );
        const failureResult1 = yield* Effect.result(queryService.getQueueViewSummaries());
        expect(failureResult1._tag).toBe("Failure");
        if (Result.isSuccess(failureResult1)) {
          throw new Error("Expected operation to fail");
        }
        const error = failureResult1.failure;
        expect(error).toBeInstanceOf(ConnectionError);
        expect(fromAny<ConnectionError, unknown>(error).message).toMatch(
          /Failed to get queue view summaries/u,
        );
      }),
    );
    it.effect("should throw AggregationTimeoutError when aggregation exceeds timeout", () =>
      Effect.gen(function* effectWorkflow33() {
        const timeoutError = Object.assign(new Error("max time expired"), { code: 50 });
        const mockAggregateCursor = {
          toArray: vi.fn<MockFunction<FindCursor["toArray"]>>().mockRejectedValueOnce(timeoutError),
        };
        vi.spyOn(ctx.mockCollection, "aggregate").mockReturnValueOnce(
          fromAny<ReturnType<typeof ctx.mockCollection.aggregate>, unknown>(mockAggregateCursor),
        );
        expect(yield* Effect.result(queryService.getQueueViewSummaries())).toMatchObject({
          _tag: "Failure",
          failure: anyMatcher(AggregationTimeoutError),
        });
      }),
    );
    it.effect("should throw AggregationTimeoutError when write concern reports timeout code", () =>
      Effect.gen(function* effectWorkflow34() {
        const timeoutError = Object.assign(new Error("write concern timeout"), {
          writeConcernError: { code: 50 },
        });
        const mockAggregateCursor = {
          toArray: vi.fn<MockFunction<FindCursor["toArray"]>>().mockRejectedValueOnce(timeoutError),
        };
        vi.spyOn(ctx.mockCollection, "aggregate").mockReturnValueOnce(
          fromAny<ReturnType<typeof ctx.mockCollection.aggregate>, unknown>(mockAggregateCursor),
        );
        expect(yield* Effect.result(queryService.getQueueViewSummaries())).toMatchObject({
          _tag: "Failure",
          failure: anyMatcher(AggregationTimeoutError),
        });
      }),
    );
  });
});
