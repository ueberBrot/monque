/**
 * Tests Change Stream setup, event delivery, reconnection, and shutdown through
 * the cursor adapter, observing emitted events and notification delivery.
 */
import { EventEmitter } from "node:events";
import { it as effectIt } from "@effect/vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import { Clock, Effect, Exit, Scope } from "effect";
import { TestClock } from "effect/testing";
import type { ChangeStream } from "mongodb";
import type { Mock } from "vite-plus/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { JobStatus } from "@/jobs";
import { fromPromise } from "@/scheduler/effects.js";
import {
  ChangeStreamHandler,
  makeChangeStreamHandler,
} from "@/scheduler/services/change-stream-handler.js";
import type { PendingNotificationSink } from "@/scheduler/services/pending-notification-router.js";
import { PendingNotificationRouter } from "@/scheduler/services/pending-notification-router.js";
import { createMockContext } from "@tests/factories";
import { objectContainingMatcher, stringContainingMatcher } from "@tests/setup/matchers.js";
import type { MockFunction } from "@tests/setup/mock-function.js";

const createStream = (closing = Promise.resolve()) =>
  // oxlint-disable-next-line unicorn/prefer-event-target -- MongoDB cursors use Node EventEmitter delivery and error-listener semantics.
  Object.assign(new EventEmitter(), {
    close: vi.fn<MockFunction<ChangeStream["close"]>>().mockReturnValue(closing),
  });

const recordingSink = () => ({
  notifyPendingJob: vi.fn<PendingNotificationSink["notifyPendingJob"]>(),
  notifyRunnableJob: vi.fn<PendingNotificationSink["notifyRunnableJob"]>(),
  setChangeStreamActive: vi.fn<PendingNotificationSink["setChangeStreamActive"]>(),
});

const nativeMonotonicTime = (): bigint => BigInt(Math.round(performance.now() * 1_000_000));

describe(ChangeStreamHandler, () => {
  let ctx: ReturnType<typeof createMockContext>;
  let onPoll: Mock<(targetNames?: ReadonlySet<string>) => Promise<void>>;
  let pendingNotifications: ReturnType<typeof recordingSink>;
  let router: PendingNotificationRouter | undefined;
  let handler: ChangeStreamHandler;

  const composeRouter = () => {
    router = new PendingNotificationRouter(ctx, (names) =>
      fromPromise(async () => {
        await onPoll(names);
      }),
    );
    handler = new ChangeStreamHandler(ctx, router);

    return router;
  };

  let streams: ReturnType<typeof createStream>[];
  let stream: ReturnType<typeof createStream>;
  beforeEach(() => {
    ctx = createMockContext();
    onPoll = vi
      .fn<(targetNames?: ReadonlySet<string>) => Promise<void>>()
      .mockResolvedValue(undefined);
    router = undefined;
    pendingNotifications = recordingSink();
    handler = new ChangeStreamHandler(ctx, pendingNotifications);
    streams = [];
    stream = createStream();
    vi.spyOn(ctx.mockCollection, "watch").mockImplementation(() => {
      const cursor = streams.length === 0 ? stream : createStream();
      streams.push(cursor);

      return fromPartial<ChangeStream>(cursor);
    });
  });
  afterEach(async () => {
    await Effect.runPromise(handler.close());
    router?.close();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  effectIt.effect("owns lazy acquisition, cursor listeners and backoff through its scope", () =>
    Effect.gen(function* ownedStreamScope() {
      const scope = yield* Scope.fork(yield* Effect.scope);

      ctx.options.recoverStaleJobs = false;

      const owned = yield* makeChangeStreamHandler(ctx, pendingNotifications).pipe(
        Scope.provide(scope),
      );

      expect(streams).toHaveLength(0);
      owned.setup();
      const nativeError = new Error("Disconnected");
      stream.emit("error", nativeError);
      yield* TestClock.adjust(999);
      expect(streams).toHaveLength(1);
      yield* TestClock.adjust(1);
      expect(streams).toHaveLength(2);
      const [, replacement] = streams;

      if (replacement === undefined) {
        throw new Error("Expected a replacement cursor");
      }

      yield* Scope.close(scope, Exit.void);
      expect({
        closures: replacement.close.mock.calls.length,
        changes: replacement.listenerCount("change"),
        tokens: replacement.listenerCount("resumeTokenChanged"),
        errors: replacement.listenerCount("error"),
      }).toStrictEqual({ closures: 1, changes: 0, tokens: 0, errors: 0 });
      owned.setup();
      yield* TestClock.adjust(10_000);
      expect(streams).toHaveLength(2);
    }),
  );

  effectIt.effect("cancels scoped backoff while retaining the synchronous retry policy", () =>
    Effect.gen(function* ownedBackoff() {
      const scope = yield* Scope.fork(yield* Effect.scope);

      const owned = yield* makeChangeStreamHandler(ctx, pendingNotifications).pipe(
        Scope.provide(scope),
      );

      owned.setup();
      stream.emit("error", new Error("First failure"));
      yield* TestClock.adjust(1000);
      streams.at(-1)?.emit("error", new Error("Second failure"));
      yield* TestClock.adjust(1999);
      expect(streams).toHaveLength(2);
      yield* TestClock.adjust(1);
      expect(streams).toHaveLength(3);
      streams.at(-1)?.emit("error", new Error("Third failure"));
      yield* TestClock.adjust(3999);
      expect(streams).toHaveLength(3);
      yield* Scope.close(scope, Exit.void);
      yield* TestClock.adjust(10_000);
      expect(streams).toHaveLength(3);
      expect(streams.every((cursor) => cursor.listenerCount("error") === 0)).toBe(true);
    }),
  );

  describe("setup", () => {
    it("does not retain a listener registered during synchronous cursor replacement", async () => {
      let replaced = false;
      stream.on("newListener", (event) => {
        if (event === "change" && !replaced) {
          replaced = true;
          handler.setup();
        }
      });
      handler.setup();
      await Promise.resolve();
      expect(stream.close).toHaveBeenCalledOnce();
      expect(stream.listenerCount("change")).toBe(0);
      expect(
        ctx.emitHistory.filter(({ event }) => event === "changestream:connected"),
      ).toHaveLength(1);
    });

    it("closes and detaches the replaced cursor before delivering from its replacement", async () => {
      handler.setup();
      const [staleChange] = stream.listeners("change");
      const [staleError] = stream.listeners("error");
      handler.setup();
      await Promise.resolve();
      expect(stream.close).toHaveBeenCalledOnce();
      expect(stream.listenerCount("change")).toBe(0);
      expect(stream.listenerCount("resumeTokenChanged")).toBe(0);
      ctx.emitHistory.length = 0;
      staleChange?.({ operationType: "insert", fullDocument: { status: JobStatus.PENDING } });
      staleError?.(new Error("Obsolete cursor"));
      expect(ctx.emitHistory).toStrictEqual([]);
      expect(streams[1]?.close).not.toHaveBeenCalled();
    });

    it.each(["changestream:connected", "changestream:fallback"])(
      "preserves a replacement opened by the %s callback after failed setup",
      async (replacementEvent) => {
        vi.useFakeTimers();
        const connectedError = new Error("Connected listener failed");
        let connected = 0;
        vi.spyOn(ctx, "emit").mockImplementation((event, payload) => {
          ctx.emitHistory.push({ event, payload });

          if (event === "changestream:connected") {
            connected += 1;
          }

          if (event === "changestream:connected" && connected === 1) {
            if (replacementEvent === event) {
              handler.setup();
            }

            throw connectedError;
          }

          if (event === "changestream:fallback" && replacementEvent === event) {
            handler.setup();
          }

          return true;
        });
        handler.setup();
        const [, replacement] = streams;

        if (replacement === undefined) {
          throw new Error("Expected the replacement cursor to be opened");
        }

        stream.emit("change", {
          operationType: "insert",
          fullDocument: { status: JobStatus.PENDING, name: "failed-stream" },
        });
        replacement.emit("change", {
          operationType: "insert",
          fullDocument: { status: JobStatus.PENDING, name: "replacement" },
        });
        expect(pendingNotifications.notifyRunnableJob).toHaveBeenCalledExactlyOnceWith(
          "replacement",
        );
        expect({
          streamCloseMockCallsLength: stream.close.mock.calls.length,
          replacementCloseMockCallsLength: replacement.close.mock.calls.length,
        }).toStrictEqual({
          streamCloseMockCallsLength: 1,
          replacementCloseMockCallsLength: 0,
        });
        await Effect.runPromise(handler.close());
        expect(replacement.close).toHaveBeenCalledOnce();
        expect(ctx.emitHistory).toContainEqual({
          event: "changestream:closed",
          payload: undefined,
        });
      },
    );

    it("closes the cursor when listener registration fails", async () => {
      vi.spyOn(stream, "on").mockImplementation(() => {
        throw new Error("Cannot register listener");
      });
      stream.close.mockRejectedValue(new Error("Cannot close cursor"));
      handler.setup();
      expect(ctx.emitHistory).toContainEqual({
        event: "changestream:fallback",
        payload: { reason: "Cannot register listener" },
      });
      await Effect.runPromise(handler.close());
      expect(stream.close).toHaveBeenCalledOnce();
    });

    it("closes a cursor when its connected listener throws and stops its notifications", async () => {
      vi.useFakeTimers();
      const connectedError = new Error("Connected listener failed");
      vi.spyOn(ctx, "emit").mockImplementation((event, payload) => {
        if (event === "changestream:connected") {
          throw connectedError;
        }

        ctx.emitHistory.push({ event, payload });

        return true;
      });
      handler.setup();
      expect(ctx.emitHistory).toContainEqual({
        event: "changestream:fallback",
        payload: { reason: connectedError.message },
      });
      stream.emit("change", {
        operationType: "insert",
        fullDocument: { status: JobStatus.PENDING, name: "failed-stream" },
      });
      await vi.advanceTimersByTimeAsync(150);
      expect({
        notifications: pendingNotifications.notifyRunnableJob.mock.calls.length,
        streamCloseMockCallsLength: stream.close.mock.calls.length,
      }).toStrictEqual({
        notifications: 0,
        streamCloseMockCallsLength: 1,
      });
      await Effect.runPromise(handler.close());
      expect(stream.close).toHaveBeenCalledOnce();
    });

    it("should not setup if scheduler is not running", () => {
      vi.spyOn(ctx, "isRunning").mockReturnValue(false);
      handler.setup();
      expect(ctx.mockCollection.watch).not.toHaveBeenCalled();
    });

    it("should create change stream and emit connected event", () => {
      handler.setup();
      expect(vi.mocked(ctx.mockCollection.watch).mock.calls.length).toBeGreaterThan(0);
      expect(ctx.emitHistory).toContainEqual(
        objectContainingMatcher({ event: "changestream:connected" }),
      );
    });

    it("should watch nextRunAt-only updates for pending jobs", () => {
      handler.setup();
      expect(ctx.mockCollection.watch).toHaveBeenCalledWith(
        [
          {
            $match: {
              $or: [
                { operationType: "insert" },
                {
                  operationType: "update",
                  $or: [
                    {
                      "updateDescription.updatedFields.status": {
                        $in: [JobStatus.PENDING, JobStatus.COMPLETED, JobStatus.FAILED],
                      },
                    },
                    { "updateDescription.updatedFields.nextRunAt": { $exists: true } },
                    { "updateDescription.updatedFields.priority": { $exists: true } },
                  ],
                },
              ],
            },
          },
          {
            $project: {
              _id: 1,
              operationType: 1,
              "fullDocument.name": 1,
              "fullDocument.status": 1,
              "fullDocument.nextRunAt": 1,
              "updateDescription.updatedFields.status": 1,
              "updateDescription.updatedFields.nextRunAt": 1,
            },
          },
        ],
        { fullDocument: "updateLookup" },
      );
    });

    it("should emit fallback event when watch throws", () => {
      vi.spyOn(ctx.mockCollection, "watch").mockImplementation(() => {
        throw new Error("Change streams not available");
      });
      handler.setup();
      expect(ctx.emitHistory).toContainEqual(
        objectContainingMatcher({ event: "changestream:fallback" }),
      );
    });
  });
  describe("cursor changes", () => {
    const due = new Date(0);
    const future = new Date(8_640_000_000_000_000);

    it.each([
      {
        label: "named insert",
        event: { operationType: "insert", fullDocument: { name: "email", nextRunAt: due } },
        name: "email",
        date: due,
      },
      {
        label: "insert without date",
        event: { operationType: "insert", fullDocument: { name: "email" } },
        name: "email",
      },
      {
        label: "insert without name",
        event: { operationType: "insert", fullDocument: { nextRunAt: due } },
      },
      {
        label: "pending update without metadata",
        event: {
          operationType: "update",
          updateDescription: { updatedFields: { status: JobStatus.PENDING } },
          fullDocument: { status: JobStatus.PENDING },
        },
      },
      {
        label: "pending update with metadata",
        event: {
          operationType: "update",
          updateDescription: { updatedFields: { status: JobStatus.PENDING } },
          fullDocument: { status: JobStatus.PENDING, name: "retry", nextRunAt: due },
        },
        name: "retry",
        date: due,
      },
      {
        label: "nextRunAt update",
        event: {
          operationType: "update",
          updateDescription: { updatedFields: { nextRunAt: due } },
          fullDocument: { status: JobStatus.PENDING, name: "retry", nextRunAt: due },
        },
        name: "retry",
        date: due,
      },
      {
        label: "future insert",
        event: { operationType: "insert", fullDocument: { name: "scheduled", nextRunAt: future } },
        name: "scheduled",
        date: future,
      },
      {
        label: "completed update",
        event: {
          operationType: "update",
          updateDescription: { updatedFields: { status: JobStatus.COMPLETED } },
          fullDocument: { status: JobStatus.COMPLETED, name: "email", nextRunAt: future },
        },
        name: "email",
      },
      {
        label: "failed update",
        event: {
          operationType: "update",
          updateDescription: { updatedFields: { status: JobStatus.FAILED } },
          fullDocument: { status: JobStatus.FAILED, name: "sms", nextRunAt: due },
        },
        name: "sms",
      },
      {
        label: "unnamed completed update",
        event: {
          operationType: "update",
          updateDescription: { updatedFields: { status: JobStatus.COMPLETED } },
          fullDocument: { status: JobStatus.COMPLETED },
        },
      },
    ])("forwards $label synchronously", ({ event, name, date }) => {
      handler.setup();
      stream.emit("change", event);
      expect(pendingNotifications.notifyPendingJob.mock.calls).toStrictEqual(
        date ? [[name, date]] : [],
      );
      expect(pendingNotifications.notifyRunnableJob.mock.calls).toStrictEqual(date ? [] : [[name]]);
      expect(pendingNotifications.notifyPendingJob.mock.calls[0]?.[1]).toBe(date);
    });

    it.each(["stopped", "processing"])(
      "filters %s events before notification delivery",
      (state) => {
        handler.setup();

        if (state === "stopped") {
          vi.mocked(ctx.isRunning).mockReturnValue(false);
        }

        stream.emit(
          "change",
          state === "stopped"
            ? { operationType: "insert", fullDocument: { name: "email", nextRunAt: due } }
            : {
                operationType: "update",
                updateDescription: { updatedFields: { status: JobStatus.PROCESSING } },
                fullDocument: { status: JobStatus.PROCESSING, name: "email", nextRunAt: due },
              },
        );
        expect(pendingNotifications.notifyPendingJob).not.toHaveBeenCalled();
        expect(pendingNotifications.notifyRunnableJob).not.toHaveBeenCalled();
      },
    );
  });
  describe("cursor errors", () => {
    it("preserves a synchronous error listener throw without scheduling a reconnect", () => {
      vi.useFakeTimers();
      handler.setup();
      const nativeError = new Error("Native cursor failure");
      const listenerError = new Error("Application listener failure");

      const emit = vi.spyOn(ctx, "emit").mockImplementation((event) => {
        if (event === "changestream:error") {
          throw listenerError;
        }

        return true;
      });

      let escaped: unknown;

      try {
        stream.emit("error", nativeError);
      } catch (error) {
        escaped = error;
      }

      expect(escaped).toBe(listenerError);
      expect(emit).toHaveBeenCalledWith("changestream:error", { error: nativeError });
      vi.advanceTimersByTime(8000);
      expect(stream.close).not.toHaveBeenCalled();
      expect(streams).toHaveLength(1);
    });

    it("lets a throwing fallback listener escape the reconnect timer callback", () => {
      vi.useFakeTimers();
      const listenerError = new Error("Fallback listener failed");
      handler.setup();
      vi.mocked(ctx.mockCollection.watch).mockImplementationOnce(() => {
        throw new Error("Reconnect failed");
      });
      const emit = ctx.emit.getMockImplementation();

      if (emit === undefined) {
        throw new Error("Expected the context event recorder");
      }

      vi.spyOn(ctx, "emit").mockImplementation((event, payload) => {
        const emitted = emit(event, payload);

        if (event === "changestream:fallback") {
          throw listenerError;
        }

        return emitted;
      });
      stream.emit("error", new Error("Disconnected"));
      let escaped: unknown;

      try {
        vi.advanceTimersByTime(1000);
      } catch (error) {
        escaped = error;
      }

      expect({
        escaped: Object.is(escaped, listenerError),
        emitHistoryFilterEventEventChangestreamFallbackLength: ctx.emitHistory.filter(
          ({ event }) => event === "changestream:fallback",
        ).length,
      }).toStrictEqual({
        escaped: true,
        emitHistoryFilterEventEventChangestreamFallbackLength: 1,
      });
    });

    it("resets backoff only after a successful server response", async () => {
      vi.useFakeTimers();
      handler.setup();
      streams.at(-1)?.emit("error", new Error("First failure"));
      vi.advanceTimersByTime(1000);
      stream.emit("resumeTokenChanged", { token: "stale" });
      stream.emit("change", {
        operationType: "insert",
        fullDocument: { status: JobStatus.PENDING },
      });
      streams.at(-1)?.emit("error", new Error("Second failure"));
      vi.advanceTimersByTime(1000);
      expect({
        streamsLength: streams.length,
        notifications: pendingNotifications.notifyRunnableJob.mock.calls.length,
      }).toStrictEqual({
        streamsLength: 2,
        notifications: 0,
      });
      vi.advanceTimersByTime(1000);
      expect(streams).toHaveLength(3);
      streams.at(-1)?.emit("resumeTokenChanged", { token: "confirmed" });
      streams.at(-1)?.emit("error", new Error("Failure after recovery"));
      vi.advanceTimersByTime(1000);
      expect(streams).toHaveLength(4);
      await Effect.runPromise(handler.close());
    });

    it("does not reconnect when a cursor error arrives after the scheduler stops", () => {
      vi.useFakeTimers();
      handler.setup();
      vi.spyOn(ctx, "isRunning").mockReturnValue(false);
      const error = new Error("Connection lost");
      stream.emit("error", error);
      vi.advanceTimersByTime(8000);
      expect({
        streamCloseMockCallsLength: stream.close.mock.calls.length,
        collectionWatchMockCallsLength: ctx.mockCollection.watch.mock.calls.length,
      }).toStrictEqual({
        streamCloseMockCallsLength: 0,
        collectionWatchMockCallsLength: 1,
      });
      expect(ctx.emitHistory).not.toContainEqual(
        objectContainingMatcher({ event: "changestream:fallback" }),
      );
    });

    it("should emit error event", () => {
      handler.setup();
      const error = new Error("Connection lost");
      stream.emit("error", error);
      expect(ctx.emitHistory).toContainEqual(
        objectContainingMatcher({
          event: "changestream:error",
          payload: { error },
        }),
      );
    });

    it("should attempt reconnection with exponential backoff", () => {
      vi.useFakeTimers();
      handler.setup();
      stream.emit("error", new Error("First error"));
      vi.advanceTimersByTime(999);
      expect(ctx.mockCollection.watch).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(1);
      expect(ctx.mockCollection.watch).toHaveBeenCalledTimes(2);
    });

    it("should stop before scheduling reconnect if scheduler stops mid-handler", () => {
      vi.useFakeTimers();
      handler.setup();
      let running = true;
      vi.spyOn(ctx, "isRunning").mockImplementation(() => running);
      stream.close.mockImplementation(async () => {
        running = false;
        await Promise.resolve();
      });
      stream.emit("error", new Error("Connection lost"));
      vi.runAllTimers();
      expect(ctx.mockCollection.watch).toHaveBeenCalledOnce();
      expect(ctx.emitHistory).not.toContainEqual(
        objectContainingMatcher({ event: "changestream:fallback" }),
      );
    });

    it("should abort reconnect when scheduler stops before reconnect starts", () => {
      vi.useFakeTimers();
      handler.setup();
      stream.emit("error", new Error("Connection lost"));
      vi.spyOn(ctx, "isRunning").mockReturnValue(false);
      vi.advanceTimersByTime(1000);
      expect(ctx.mockCollection.watch).toHaveBeenCalledOnce();
    });

    it("should emit fallback event after exhausting reconnection attempts", () => {
      vi.useFakeTimers();
      handler.setup();

      // Emit 4 errors (maxReconnectAttempts is 3)
      for (let i = 0; i < 4; i += 1) {
        streams.at(-1)?.emit("error", new Error(`Error ${i + 1}`));
        // Advance past the exponential backoff
        vi.advanceTimersByTime(10_000);
      }

      expect(streams).toHaveLength(4);
      expect(ctx.emitHistory).toContainEqual(
        objectContainingMatcher({
          event: "changestream:fallback",
          payload: objectContainingMatcher({
            reason: stringContainingMatcher("Exhausted"),
          }),
        }),
      );
    });
  });
  describe("close", () => {
    it.each([false, true])(
      "keeps a fenced error listener until native close settles (rejects: %s)",
      async (rejects) => {
        const closed: PromiseWithResolvers<void> = Promise.withResolvers();
        stream.close.mockReturnValue(closed.promise);
        const foreignChange = vi.fn<() => void>();
        const foreignToken = vi.fn<() => void>();
        const foreignError = vi.fn<() => void>();
        stream.on("change", foreignChange);
        stream.on("resumeTokenChanged", foreignToken);
        stream.on("error", foreignError);
        handler.setup();
        const closing = Effect.runPromise(handler.close());

        try {
          expect({
            changes: stream.listeners("change"),
            tokens: stream.listeners("resumeTokenChanged"),
            errors: stream.listenerCount("error"),
          }).toStrictEqual({ changes: [foreignChange], tokens: [foreignToken], errors: 2 });
          ctx.emitHistory.length = 0;
          stream.emit("error", new Error("Late native close error"));
          expect(foreignError).toHaveBeenCalledOnce();
          expect(ctx.emitHistory).toStrictEqual([]);
        } finally {
          if (rejects) {
            closed.reject(new Error("Native close rejected"));
          } else {
            closed.resolve();
          }

          await closing;
        }

        expect({
          changes: stream.listeners("change"),
          tokens: stream.listeners("resumeTokenChanged"),
          errors: stream.listeners("error"),
          closures: stream.close.mock.calls.length,
        }).toStrictEqual({
          changes: [foreignChange],
          tokens: [foreignToken],
          errors: [foreignError],
          closures: 1,
        });
      },
    );

    it("clears the native reconnect timer immediately and detaches all owned listeners", async () => {
      vi.useFakeTimers();
      handler.setup();
      stream.emit("error", new Error("Disconnected"));
      expect(vi.getTimerCount()).toBe(1);
      const closing = Effect.runPromise(handler.close());
      expect(vi.getTimerCount()).toBe(0);
      await closing;
      expect({
        changes: stream.listenerCount("change"),
        tokens: stream.listenerCount("resumeTokenChanged"),
        errors: stream.listenerCount("error"),
      }).toStrictEqual({ changes: 0, tokens: 0, errors: 0 });
      await vi.advanceTimersByTimeAsync(8000);
      expect(streams).toHaveLength(1);
    });

    it.each(["changestream:error", "changestream:closed"])(
      "preserves a replacement opened by the %s callback",
      async (restartEvent) => {
        vi.useFakeTimers();
        handler.setup();
        let restarted = false;
        vi.spyOn(ctx, "emit").mockImplementation((event, payload) => {
          ctx.emitHistory.push({ event, payload });

          if (event === restartEvent && !restarted) {
            restarted = true;
            void Effect.runPromise(handler.close());
            handler.setup();
          }

          return true;
        });

        if (restartEvent === "changestream:error") {
          stream.emit("error", new Error("Restart"));
        } else {
          await Effect.runPromise(handler.close());
        }

        await vi.advanceTimersByTimeAsync(1000);
        expect(ctx.mockCollection.watch).toHaveBeenCalledTimes(2);
        const [, replacement] = streams;

        if (replacement === undefined) {
          throw new Error("Expected the replacement cursor to be opened");
        }

        expect(replacement.close).not.toHaveBeenCalled();
        replacement.emit("change", {
          operationType: "insert",
          fullDocument: { status: JobStatus.PENDING, name: "replacement" },
        });
        expect(pendingNotifications.notifyRunnableJob).toHaveBeenCalledExactlyOnceWith(
          "replacement",
        );
      },
    );

    it("ignores a closing stream while a replacement remains active", async () => {
      vi.useFakeTimers();
      const closed: PromiseWithResolvers<void> = Promise.withResolvers();
      const oldStream = createStream(closed.promise);
      const replacement = createStream();
      vi.spyOn(ctx.mockCollection, "watch")
        .mockReturnValueOnce(fromPartial<ChangeStream>(oldStream))
        .mockReturnValue(fromPartial<ChangeStream>(replacement));
      handler.setup();
      const closing = Effect.runPromise(handler.close());

      try {
        oldStream.emit("change", {
          operationType: "insert",
          fullDocument: { status: JobStatus.PENDING, name: "old" },
        });
        oldStream.emit("error", new Error("Closing cursor failed"));
        await vi.advanceTimersByTimeAsync(100);
        expect(pendingNotifications.notifyPendingJob).not.toHaveBeenCalled();
        expect(pendingNotifications.notifyRunnableJob).not.toHaveBeenCalled();
        expect(ctx.emitHistory).not.toContainEqual(
          objectContainingMatcher({ event: "changestream:error" }),
        );
        handler.setup();
        closed.resolve();
        await closing;
        replacement.emit("change", {
          operationType: "insert",
          fullDocument: { status: JobStatus.PENDING, name: "replacement" },
        });
        expect(pendingNotifications.notifyRunnableJob).toHaveBeenCalledExactlyOnceWith(
          "replacement",
        );
        expect(replacement.close).not.toHaveBeenCalled();
      } finally {
        closed.resolve();
        await closing;
        await Effect.runPromise(handler.close());
      }

      expect(replacement.close).toHaveBeenCalledOnce();
    });

    it("preserves replacement backoff when an earlier close completes", async () => {
      vi.useFakeTimers();
      const closed: PromiseWithResolvers<void> = Promise.withResolvers();

      const replacementStreams = Array.from({ length: 5 }, (_, index) =>
        createStream(index === 0 ? closed.promise : Promise.resolve()),
      );

      const replacementAt = (index: number) => {
        const cursor = replacementStreams[index];

        if (cursor === undefined) {
          throw new Error(`Expected replacement cursor ${index}`);
        }

        return cursor;
      };

      const watch = vi.spyOn(ctx.mockCollection, "watch");

      for (const replacementStream of replacementStreams) {
        watch.mockReturnValueOnce(fromPartial<ChangeStream>(replacementStream));
      }

      handler.setup();
      const closing = Effect.runPromise(handler.close());

      try {
        handler.setup();
        replacementAt(1).emit("error", new Error("First replacement failure"));
        closed.resolve();
        await closing;
        await vi.advanceTimersByTimeAsync(1000);
        expect(watch).toHaveBeenCalledTimes(3);
        replacementAt(2).emit("error", new Error("Second replacement failure"));
        await vi.advanceTimersByTimeAsync(1999);
        expect(watch).toHaveBeenCalledTimes(3);
        await vi.advanceTimersByTimeAsync(1);
        expect(watch).toHaveBeenCalledTimes(4);
        replacementAt(3).emit("error", new Error("Third replacement failure"));
        await vi.advanceTimersByTimeAsync(4000);
        replacementAt(4).emit("error", new Error("Fourth replacement failure"));
        await vi.advanceTimersByTimeAsync(8000);
        expect(watch).toHaveBeenCalledTimes(5);
        expect(ctx.emitHistory).toContainEqual(
          objectContainingMatcher({
            event: "changestream:fallback",
            payload: { reason: "Exhausted 3 reconnection attempts: Fourth replacement failure" },
          }),
        );
      } finally {
        closed.resolve();
        await closing;
        await Effect.runPromise(handler.close());
      }
    });

    it("should close change stream and emit closed event", async () => {
      handler.setup();
      await Effect.runPromise(handler.close());
      expect(vi.mocked(stream.close).mock.calls.length).toBeGreaterThan(0);
      expect(ctx.emitHistory).toContainEqual(
        objectContainingMatcher({ event: "changestream:closed" }),
      );
    });
  });
  describe("composed notification ownership", () => {
    it("shortens the full-poll deadline on disconnect without needing a notification", async () => {
      vi.useFakeTimers();
      const notifications = composeRouter();
      vi.spyOn(Effect.runSync(Clock.Clock), "monotonicTimeNanosUnsafe").mockImplementation(
        nativeMonotonicTime,
      );
      handler.setup();
      notifications.start();
      await vi.advanceTimersByTimeAsync(200);
      vi.mocked(onPoll).mockClear();
      stream.emit("error", new Error("Disconnected"));
      await vi.advanceTimersByTimeAsync(999);
      expect(onPoll).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(onPoll).toHaveBeenCalledExactlyOnceWith(undefined);
      await Effect.runPromise(handler.close());
    });

    it("preserves local-write wakeups across disconnect and reconnect", async () => {
      vi.useFakeTimers();
      const notifications = composeRouter();
      handler.setup();
      notifications.notifyPendingJob("local", new Date(Date.now() + 1500));
      stream.emit("error", new Error("Disconnected"));
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(700);
      expect(onPoll).toHaveBeenCalledExactlyOnceWith(new Set(["local"]));
      await Effect.runPromise(handler.close());
    });

    it.each([
      { action: "error", future: false },
      { action: "error", future: true },
      { action: "close", future: false },
      { action: "close", future: true },
    ])("preserves router work after $action (future: $future)", async ({ action, future }) => {
      vi.useFakeTimers();
      composeRouter();
      handler.setup();
      stream.emit("change", {
        operationType: "insert",
        fullDocument: {
          name: "email",
          status: JobStatus.PENDING,
          nextRunAt: new Date(Date.now() + (future ? 5000 : -1000)),
        },
      });

      if (action === "error") {
        stream.emit("error", new Error("Disconnected"));
      } else {
        await Effect.runPromise(handler.close());
      }

      await vi.advanceTimersByTimeAsync(future ? 6000 : 150);
      expect(onPoll).toHaveBeenCalledExactlyOnceWith(new Set(["email"]));
    });
  });
});
