import { it as effectIt } from "@effect/vitest";
import { Clock, Effect } from "effect";
import { TestClock } from "effect/testing";
import type { Mock } from "vite-plus/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { fromPromise } from "@/scheduler/effects.js";
import { PendingNotificationRouter } from "@/scheduler/services/pending-notification-router.js";
import { createMockContext } from "@tests/factories";
import { clockWithWallTime } from "@tests/setup/clock.js";
import { nativeAsyncMock } from "@tests/setup/native-async-mock.js";

type PollCallback = (targetNames?: ReadonlySet<string>) => Promise<void>;

const monotonicTimeNanos = () => BigInt(Math.round(performance.now() * 1_000_000));

describe(PendingNotificationRouter, () => {
  let ctx: ReturnType<typeof createMockContext>;
  let onPoll: Mock<PollCallback>;
  let router: PendingNotificationRouter;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Effect.runSync(Clock.Clock), "monotonicTimeNanosUnsafe").mockImplementation(
      monotonicTimeNanos,
    );
    ctx = createMockContext();
    onPoll = vi
      .fn<(targetNames?: ReadonlySet<string>) => Promise<void>>()
      .mockResolvedValue(undefined);
    router = new PendingNotificationRouter(ctx, (...args) =>
      fromPromise(async () => {
        await onPoll(...args);
      }),
    );
  });
  afterEach(() => {
    router.close();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("routes immediate Job Names together and wakes once for the earliest future Job", () => {
    router.notifyPendingJob("email", new Date(Date.now() - 1000));
    router.notifyPendingJob("sms", new Date(Date.now() - 1000));
    router.notifyPendingJob("late", new Date(Date.now() + 10_000));
    router.notifyPendingJob("early", new Date(Date.now() + 3000));
    vi.advanceTimersByTime(150);
    expect(onPoll).toHaveBeenCalledExactlyOnceWith(new Set(["email", "sms"]));
    vi.advanceTimersByTime(3050);
    expect(onPoll).toHaveBeenCalledTimes(2);
    expect(onPoll).toHaveBeenLastCalledWith(new Set(["early"]));
  });

  it("deduplicates repeated immediate notifications for the same Job Name", () => {
    const nextRunAt = new Date(Date.now() - 1000);
    router.notifyPendingJob("email", nextRunAt);
    router.notifyPendingJob("email", nextRunAt);
    vi.advanceTimersByTime(150);
    expect(onPoll).toHaveBeenCalledExactlyOnceWith(new Set(["email"]));
  });

  it("routes notifications received synchronously while the previous batch starts polling", () => {
    vi.mocked(onPoll).mockImplementationOnce(
      nativeAsyncMock<PollCallback>(() => {
        router.notifyRunnableJob("sms");
      }),
    );
    router.notifyRunnableJob("email");
    vi.advanceTimersByTime(100);
    expect(onPoll).toHaveBeenCalledExactlyOnceWith(new Set(["email"]));
    vi.advanceTimersByTime(100);
    expect(onPoll).toHaveBeenCalledTimes(2);
    expect(onPoll).toHaveBeenLastCalledWith(new Set(["sms"]));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("collects names across due deadlines without checking unrelated workers", () => {
    router.notifyPendingJob("email", new Date(Date.now() + 1000));
    router.notifyPendingJob("email", new Date(Date.now() + 1000));
    router.notifyPendingJob("sms", new Date(Date.now() + 1100));
    router.notifyPendingJob("later", new Date(Date.now() + 5000));
    vi.advanceTimersByTime(1200);
    expect(onPoll).toHaveBeenCalledExactlyOnceWith(new Set(["email", "sms"]));
    vi.advanceTimersByTime(4000);
    expect(onPoll).toHaveBeenLastCalledWith(new Set(["later"]));
  });

  it.each([false, true])("preserves unknown future names, unknown first: %s", (unknownFirst) => {
    const names = unknownFirst ? [undefined, "email"] : ["email", undefined];
    for (const name of names) {
      router.notifyPendingJob(name, new Date(Date.now() + 1000));
    }
    vi.advanceTimersByTime(1200);
    expect(onPoll).toHaveBeenCalledExactlyOnceWith();
  });

  it("keeps a wakeup when too many names share one deadline, then restores targeting", () => {
    const runAt = new Date(Date.now() + 1000);
    for (let i = 0; i < 2000; i += 1) {
      router.notifyPendingJob(`worker-${i}`, runAt);
    }
    vi.advanceTimersByTime(1200);
    expect(onPoll).toHaveBeenCalledExactlyOnceWith();
    router.notifyPendingJob("email", new Date(Date.now() + 1000));
    vi.advanceTimersByTime(1200);
    expect(onPoll).toHaveBeenLastCalledWith(new Set(["email"]));
  });

  it("polls within a bounded window while notifications keep arriving", () => {
    for (let i = 0; i < 20; i += 1) {
      router.notifyRunnableJob(i % 2 === 0 ? "email" : "sms");
      vi.advanceTimersByTime(50);
    }
    expect(onPoll).toHaveBeenCalledTimes(10);
    expect(onPoll).toHaveBeenLastCalledWith(new Set(["email", "sms"]));
  });

  it("does not route pending notifications when the scheduler is stopped", () => {
    vi.mocked(ctx.isRunning).mockReturnValue(false);
    router.notifyPendingJob("email", new Date(Date.now() - 1000));
    vi.advanceTimersByTime(150);
    expect(onPoll).not.toHaveBeenCalled();
  });

  it("does not route runnable notifications when the scheduler is stopped", () => {
    vi.mocked(ctx.isRunning).mockReturnValue(false);
    router.notifyRunnableJob("email");
    vi.advanceTimersByTime(150);
    expect(onPoll).not.toHaveBeenCalled();
  });

  it("routes runnable notifications without a Job Name as a full poll", () => {
    router.notifyRunnableJob();
    vi.advanceTimersByTime(150);
    expect(onPoll).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it.each([false, true])(
    "preserves a full poll in a mixed batch, unnamed first: %s",
    (unnamedFirst) => {
      const names = unnamedFirst ? [undefined, "email"] : ["email", undefined];
      for (const name of names) {
        router.notifyRunnableJob(name);
      }
      vi.advanceTimersByTime(100);
      expect(onPoll).toHaveBeenCalledExactlyOnceWith(undefined);
      router.notifyRunnableJob("sms");
      vi.advanceTimersByTime(100);
      expect(onPoll).toHaveBeenLastCalledWith(new Set(["sms"]));
    },
  );

  it("routes immediate pending notifications without a Job Name as a full poll", () => {
    router.notifyPendingJob(undefined, new Date(Date.now() - 1000));
    vi.advanceTimersByTime(150);
    expect(onPoll).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it("allows close to be called repeatedly without polling", () => {
    router.notifyPendingJob("email", new Date(Date.now() - 1000));
    router.notifyPendingJob("late", new Date(Date.now() + 1000));
    router.notifyPendingJob("later", new Date(Date.now() + 2000));
    expect(() => {
      router.close();
      router.close();
      router.close();
    }).not.toThrow();
    vi.advanceTimersByTime(2500);
    expect(onPoll).not.toHaveBeenCalled();
    router.notifyPendingJob("new", new Date(Date.now() + 1000));
    vi.advanceTimersByTime(1250);
    expect({
      onPollMockCallsLength: onPoll.mock.calls.length,
      timerCount: vi.getTimerCount(),
    }).toStrictEqual({
      onPollMockCallsLength: 1,
      timerCount: 0,
    });
  });

  it("emits job:error when polling rejects and continues routing later notifications", async () => {
    const pollError = new Error("Poll failed");
    onPoll = vi
      .fn<(targetNames?: ReadonlySet<string>) => Promise<void>>()
      .mockRejectedValueOnce(pollError)
      .mockResolvedValueOnce(undefined);
    router.close();
    router = new PendingNotificationRouter(ctx, (...args) =>
      fromPromise(async () => {
        await onPoll(...args);
      }),
    );
    router.notifyPendingJob("email", new Date(Date.now() - 1000));
    await vi.advanceTimersByTimeAsync(150);
    expect(ctx.emitHistory).toContainEqual({
      event: "job:error",
      payload: { error: pollError },
    });
    router.notifyPendingJob("sms", new Date(Date.now() - 1000));
    await vi.advanceTimersByTimeAsync(150);
    expect(onPoll).toHaveBeenCalledTimes(2);
    expect(onPoll).toHaveBeenLastCalledWith(new Set(["sms"]));
  });

  it("keeps the earliest future wakeup when a later pending Job is notified", () => {
    router.notifyPendingJob("early", new Date(Date.now() + 1000));
    router.notifyPendingJob("late", new Date(Date.now() + 10_000));
    vi.advanceTimersByTime(1250);
    expect(onPoll).toHaveBeenCalledExactlyOnceWith(new Set(["early"]));
  });

  it.each([false, true])(
    "wakes for every future deadline, notified latest first: %s",
    (latestFirst) => {
      const deadlines = [1000, 5000, 9000];
      if (latestFirst) {
        deadlines.reverse();
      }
      for (const delay of deadlines) {
        const runAt = new Date(Date.now() + delay);
        router.notifyPendingJob("email", runAt);
        router.notifyPendingJob("email", runAt);
      }
      vi.advanceTimersByTime(1200);
      expect(onPoll).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(4000);
      expect(onPoll).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(4000);
      expect({
        onPollMockCallsLength: onPoll.mock.calls.length,
        timerCount: vi.getTimerCount(),
      }).toStrictEqual({
        onPollMockCallsLength: 3,
        timerCount: 0,
      });
    },
  );

  it("waits for a distant job without overflowing the timer or polling early", () => {
    const ninetyDays = 90 * 24 * 60 * 60 * 1000;
    router.notifyPendingJob("annual-report", new Date(Date.now() + ninetyDays));
    vi.advanceTimersByTime(ninetyDays - 1);
    expect(onPoll).not.toHaveBeenCalled();
    vi.advanceTimersByTime(201);
    expect(onPoll).toHaveBeenCalledExactlyOnceWith(new Set(["annual-report"]));
  });

  it.each([false, true])(
    "bounds wakeup polls after repeated future rescheduling, latest first: %s",
    (latestFirst) => {
      const now = Date.now();
      for (let i = 0; i < 10_000; i += 1) {
        const delay = latestFirst ? 10_000_000 - i * 1000 : 1000 + i * 1000;
        router.notifyPendingJob("email", new Date(now + delay));
      }
      vi.advanceTimersByTime(1200);
      expect(onPoll).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(10_000_000);
      expect(onPoll.mock.calls.length).toBeLessThanOrEqual(1024);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each([false, true])(
    "discovers later jobs through full polling after wakeup saturation, stream active: %s",
    async (streamActive) => {
      const now = Date.now();
      const executedAt: number[] = [];
      const pendingRunTimes = [4500, 7000];
      vi.mocked(onPoll).mockImplementation(
        nativeAsyncMock<PollCallback>(() => {
          while (pendingRunTimes[0] !== undefined && pendingRunTimes[0] <= Date.now() - now) {
            pendingRunTimes.shift();
            executedAt.push(Date.now() - now);
          }
        }),
      );
      ctx.options.safetyPollInterval = 3000;
      router.setChangeStreamActive(streamActive);
      router.start();
      await vi.advanceTimersByTimeAsync(0);
      for (let i = 0; i < 10_000; i += 1) {
        router.notifyPendingJob("email", new Date(now + 1000 + i));
      }
      for (const runAt of pendingRunTimes) {
        router.notifyPendingJob("email", new Date(now + runAt));
      }
      await vi.advanceTimersByTimeAsync(9000);
      expect(executedAt).toStrictEqual(streamActive ? [6000, 9000] : [5000, 7000]);
    },
  );

  it("emits job:error when a future wakeup poll rejects and preserves later wakeups", async () => {
    const pollError = new Error("Wakeup poll failed");
    onPoll = vi
      .fn<(targetNames?: ReadonlySet<string>) => Promise<void>>()
      .mockResolvedValue(undefined)
      .mockRejectedValueOnce(pollError);
    router.close();
    router = new PendingNotificationRouter(ctx, (...args) =>
      fromPromise(async () => {
        await onPoll(...args);
      }),
    );
    router.notifyPendingJob("email", new Date(Date.now() + 1000));
    router.notifyPendingJob("sms", new Date(Date.now() + 2000));
    await vi.advanceTimersByTimeAsync(1250);
    expect(ctx.emitHistory).toContainEqual({
      event: "job:error",
      payload: { error: pollError },
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(onPoll).toHaveBeenCalledTimes(2);
  });

  it("keeps full safety polls running during sustained targeted notifications", async () => {
    ctx.options.safetyPollInterval = 1000;
    router.setChangeStreamActive(true);
    router.start();
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 20; i += 1) {
      router.notifyRunnableJob("email");
      // oxlint-disable-next-line eslint/no-await-in-loop -- Each notification must follow the preceding 500 ms of timer and Promise processing to model a sustained stream.
      await vi.advanceTimersByTimeAsync(500);
    }
    const fullPolls = vi.mocked(onPoll).mock.calls.filter(([names]) => names === undefined);
    expect(fullPolls).toHaveLength(11);
    expect(onPoll).toHaveBeenCalledWith(new Set(["email"]));
  });

  it("polls immediately on start and uses the fallback interval without streams", async () => {
    router.start();
    expect(onPoll).toHaveBeenCalledExactlyOnceWith();
    await vi.advanceTimersByTimeAsync(999);
    expect(onPoll).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(onPoll).toHaveBeenCalledTimes(2);
  });

  it("uses the safety interval while streams are available", async () => {
    router.setChangeStreamActive(true);
    router.start();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(onPoll).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(onPoll).toHaveBeenCalledTimes(2);
  });

  it("continues full discovery after poll errors", async () => {
    const error = new Error("Discovery failed");
    vi.mocked(onPoll).mockRejectedValueOnce(error);
    router.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(ctx.emitHistory).toContainEqual({ event: "job:error", payload: { error } });
    expect(onPoll).toHaveBeenCalledTimes(2);
  });

  it("closes all scheduling timers even while the initial poll is in flight", async () => {
    const pending: PromiseWithResolvers<void> = Promise.withResolvers();
    vi.mocked(onPoll).mockReturnValueOnce(pending.promise);
    router.start();
    router.notifyRunnableJob("email");
    router.notifyPendingJob("future", new Date(Date.now() + 2000));
    router.close();
    pending.resolve();
    await vi.advanceTimersByTimeAsync(60_000);
    expect({
      onPollMockCallsLength: onPoll.mock.calls.length,
      timerCount: vi.getTimerCount(),
    }).toStrictEqual({
      onPollMockCallsLength: 1,
      timerCount: 0,
    });
  });

  it("starts only once and can restart after closing", async () => {
    router.start();
    router.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onPoll).toHaveBeenCalledTimes(2);
    router.close();
    router.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onPoll).toHaveBeenCalledTimes(4);
  });
});
describe("PendingNotificationRouter Effect scheduling", () => {
  effectIt.effect.each([false, true])(
    "keeps full polling on elapsed time after a backward clock correction, stream active: %s",
    (streamActive) =>
      Effect.gen(function* effectWorkflow1() {
        const clock = yield* Clock.Clock;
        const testClock = yield* TestClock.testClockWith(Effect.succeed);
        let wallOffset = 60_000;
        const currentTimeMillis = () => clock.currentTimeMillisUnsafe() + wallOffset;
        yield* Effect.gen(function* effectWorkflow2() {
          const context = yield* Effect.context();
          const ctx = createMockContext();
          ctx.options.pollInterval = 1000;
          ctx.options.safetyPollInterval = 3000;
          const interval = streamActive ? 3000 : 1000;
          const poll = vi.fn<() => Effect.Effect<void>>().mockReturnValue(Effect.void);
          const router = new PendingNotificationRouter(
            ctx,
            poll,
            Effect.runForkWith(context),
            yield* Clock.Clock,
          );
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              router.close();
            }),
          );
          router.setChangeStreamActive(streamActive);
          router.start();
          expect(poll).toHaveBeenCalledOnce();
          wallOffset -= 60_000;
          yield* testClock.adjust(interval - 1);
          expect(poll).toHaveBeenCalledOnce();
          yield* testClock.adjust(1);
          expect(poll).toHaveBeenCalledTimes(2);
          yield* testClock.adjust(interval);
          expect(poll).toHaveBeenCalledTimes(3);
        }).pipe(
          Effect.provideService(
            Clock.Clock,
            clockWithWallTime(clock, Effect.sync(currentTimeMillis), currentTimeMillis),
          ),
        );
      }).pipe(Effect.scoped),
  );
  effectIt.effect(
    "uses Effect time for the earliest wakeup and cancels later wakeups on close",
    () =>
      Effect.gen(function* effectWorkflow3() {
        const context = yield* Effect.context();
        const ctx = createMockContext();
        const polls: (ReadonlySet<string> | undefined)[] = [];
        const router = new PendingNotificationRouter(
          ctx,
          (names) =>
            Effect.sync(() => {
              polls.push(names);
            }),
          Effect.runForkWith(context),
          yield* Clock.Clock,
        );
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            router.close();
          }),
        );
        yield* TestClock.setTime(new Date("2025-06-01T12:00:00.000Z").getTime());
        router.notifyPendingJob("late", new Date("2025-06-01T12:00:05.000Z"));
        router.notifyPendingJob("early", new Date("2025-06-01T12:00:01.000Z"));
        yield* TestClock.adjust(1199);
        expect(polls).toStrictEqual([]);
        yield* TestClock.adjust(1);
        expect(polls).toStrictEqual([new Set(["early"])]);
        router.close();
        yield* TestClock.adjust(10_000);
        expect({
          polls,
          emitHistory: ctx.emitHistory,
        }).toStrictEqual({
          polls: [new Set(["early"])],
          emitHistory: [],
        });
      }).pipe(Effect.scoped),
  );
});
