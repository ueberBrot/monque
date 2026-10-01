/**
 * Tests Change Stream setup, event delivery, reconnection, and shutdown through
 * the cursor adapter, observing emitted events and scheduled polls.
 */

import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { JobStatus } from "@/jobs";
import { ChangeStreamHandler } from "@/scheduler/services/change-stream-handler.js";
import { PendingNotificationRouter } from "@/scheduler/services/pending-notification-router.js";
import { createMockContext } from "@tests/factories";

describe("ChangeStreamHandler", () => {
  let ctx: ReturnType<typeof createMockContext>;
  let onPoll: (targetNames?: ReadonlySet<string>) => Promise<void>;
  let pendingNotifications: PendingNotificationRouter;
  let handler: ChangeStreamHandler;
  let streams: ReturnType<typeof createStream>[];
  let stream: ReturnType<typeof createStream>;

  function createStream() {
    return Object.assign(new EventEmitter(), {
      close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    });
  }

  beforeEach(() => {
    ctx = createMockContext();
    onPoll = vi
      .fn<(targetNames?: ReadonlySet<string>) => Promise<void>>()
      .mockResolvedValue(undefined);
    pendingNotifications = new PendingNotificationRouter(ctx, onPoll);
    handler = new ChangeStreamHandler(ctx, pendingNotifications);
    streams = [];
    stream = createStream();
    vi.spyOn(ctx.collection, "watch").mockImplementation(() => {
      const cursor = streams.length === 0 ? stream : createStream();
      streams.push(cursor);
      return cursor as unknown as ReturnType<typeof ctx.collection.watch>;
    });
  });

  afterEach(async () => {
    await handler.close();
    pendingNotifications.close();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe("setup", () => {
    it("should not setup if scheduler is not running", () => {
      vi.spyOn(ctx, "isRunning").mockReturnValue(false);

      handler.setup();

      expect(ctx.mockCollection.watch).not.toHaveBeenCalled();
    });

    it("should create change stream and emit connected event", () => {
      handler.setup();

      expect(ctx.mockCollection.watch).toHaveBeenCalled();
      expect(ctx.emitHistory).toContainEqual(
        expect.objectContaining({ event: "changestream:connected" }),
      );
    });

    it("should watch nextRunAt-only updates for pending jobs", () => {
      handler.setup();

      expect(ctx.collection.watch).toHaveBeenCalledWith(
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

    it("should forward change events from the stream to the handler", () => {
      vi.useFakeTimers();

      handler.setup();
      stream.emit("change", {
        operationType: "insert",
        fullDocument: {
          status: JobStatus.PENDING,
          name: "test-job",
          nextRunAt: new Date(Date.now() - 1000),
        },
      });
      vi.advanceTimersByTime(150);

      expect(onPoll).toHaveBeenCalledOnce();
      expect(onPoll).toHaveBeenCalledWith(new Set(["test-job"]));
    });

    it("should emit fallback event when watch throws", () => {
      vi.spyOn(ctx.mockCollection, "watch").mockImplementation(() => {
        throw new Error("Change streams not available");
      });

      handler.setup();

      expect(ctx.emitHistory).toContainEqual(
        expect.objectContaining({ event: "changestream:fallback" }),
      );
    });
  });

  describe("cursor changes", () => {
    beforeEach(() => handler.setup());

    it("should not trigger poll if scheduler is not running", () => {
      vi.useFakeTimers();
      vi.spyOn(ctx, "isRunning").mockReturnValue(false);

      const changeEvent = {
        operationType: "insert" as const,
        fullDocument: { status: JobStatus.PENDING },
      };

      stream.emit("change", changeEvent);
      vi.advanceTimersByTime(200);

      expect(onPoll).not.toHaveBeenCalled();
    });

    it("should trigger poll on insert event (debounced)", async () => {
      vi.useFakeTimers();
      const changeEvent = {
        operationType: "insert" as const,
        fullDocument: { status: JobStatus.PENDING },
      };

      stream.emit("change", changeEvent);

      // Debounce should prevent immediate call
      expect(onPoll).not.toHaveBeenCalled();

      // After debounce window, poll should be called
      vi.advanceTimersByTime(150);
      expect(onPoll).toHaveBeenCalledOnce();
    });

    it("should trigger poll on update event with status change to pending", async () => {
      vi.useFakeTimers();
      const changeEvent = {
        operationType: "update" as const,
        fullDocument: { status: JobStatus.PENDING },
        updateDescription: { updatedFields: { status: JobStatus.PENDING } },
      };

      stream.emit("change", changeEvent);
      vi.advanceTimersByTime(150);

      expect(onPoll).toHaveBeenCalledOnce();
    });

    it("should trigger poll on update event with nextRunAt change for pending job", async () => {
      vi.useFakeTimers();
      const changeEvent = {
        operationType: "update" as const,
        fullDocument: {
          status: JobStatus.PENDING,
          name: "retry-job",
          nextRunAt: new Date(Date.now() - 1000),
        },
        updateDescription: { updatedFields: { nextRunAt: new Date(Date.now() - 1000) } },
      };

      stream.emit("change", changeEvent);
      vi.advanceTimersByTime(150);

      expect(onPoll).toHaveBeenCalledOnce();
      expect(onPoll).toHaveBeenCalledWith(new Set(["retry-job"]));
    });

    it("should debounce multiple rapid events", async () => {
      vi.useFakeTimers();
      const changeEvent = {
        operationType: "insert" as const,
        fullDocument: { status: JobStatus.PENDING },
      };

      // Trigger multiple events within one bounded batching window.
      stream.emit("change", changeEvent);
      vi.advanceTimersByTime(25);
      stream.emit("change", changeEvent);
      vi.advanceTimersByTime(25);
      stream.emit("change", changeEvent);
      vi.advanceTimersByTime(150);

      // Should only call once due to debouncing
      expect(onPoll).toHaveBeenCalledOnce();
    });
  });

  describe("cursor errors", () => {
    it("shortens the full-poll deadline on disconnect without needing a notification", async () => {
      vi.useFakeTimers();
      handler.setup();
      pendingNotifications.start();
      await vi.advanceTimersByTimeAsync(200);
      vi.mocked(onPoll).mockClear();
      stream.emit("error", new Error("Disconnected"));

      await vi.advanceTimersByTimeAsync(999);
      expect(onPoll).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(onPoll).toHaveBeenCalledExactlyOnceWith();
      await handler.close();
    });

    it("preserves local-write wakeups across disconnect and reconnect", async () => {
      vi.useFakeTimers();
      handler.setup();
      pendingNotifications.notifyPendingJob("local", new Date(Date.now() + 1500));
      stream.emit("error", new Error("Disconnected"));

      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(700);
      expect(onPoll).toHaveBeenCalledExactlyOnceWith(new Set(["local"]));
      await handler.close();
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
      expect(streams).toHaveLength(2);
      expect(onPoll).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1000);
      expect(streams).toHaveLength(3);

      streams.at(-1)?.emit("resumeTokenChanged", { token: "confirmed" });
      streams.at(-1)?.emit("error", new Error("Failure after recovery"));
      vi.advanceTimersByTime(1000);
      expect(streams).toHaveLength(4);
      await handler.close();
    });

    it("does not reconnect when a cursor error arrives after the scheduler stops", () => {
      vi.useFakeTimers();
      handler.setup();
      vi.spyOn(ctx, "isRunning").mockReturnValue(false);

      const error = new Error("Connection lost");
      stream.emit("error", error);
      vi.advanceTimersByTime(8000);
      expect(stream.close).not.toHaveBeenCalled();
      expect(ctx.collection.watch).toHaveBeenCalledOnce();
      expect(ctx.emitHistory).not.toContainEqual(
        expect.objectContaining({ event: "changestream:fallback" }),
      );
    });

    it("should emit error event", () => {
      handler.setup();

      const error = new Error("Connection lost");
      stream.emit("error", error);

      expect(ctx.emitHistory).toContainEqual(
        expect.objectContaining({
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
      expect(ctx.collection.watch).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(1);
      expect(ctx.collection.watch).toHaveBeenCalledTimes(2);
    });

    it("should stop before scheduling reconnect if scheduler stops mid-handler", () => {
      vi.useFakeTimers();
      handler.setup();
      let running = true;
      vi.spyOn(ctx, "isRunning").mockImplementation(() => running);
      stream.close.mockImplementation(() => {
        running = false;
        return Promise.resolve();
      });

      stream.emit("error", new Error("Connection lost"));
      vi.runAllTimers();

      expect(ctx.mockCollection.watch).toHaveBeenCalledOnce();
      expect(ctx.emitHistory).not.toContainEqual(
        expect.objectContaining({ event: "changestream:fallback" }),
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

    it("should abort reconnect when scheduler stops after closing the stream", () => {
      vi.useFakeTimers();
      handler.setup();
      vi.spyOn(ctx, "isRunning")
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true)
        .mockReturnValue(false);

      stream.emit("error", new Error("Connection lost"));
      vi.advanceTimersByTime(1000);

      expect(ctx.mockCollection.watch).toHaveBeenCalledOnce();
    });

    it("should emit fallback event after exhausting reconnection attempts", () => {
      vi.useFakeTimers();

      handler.setup();

      // Emit 4 errors (maxReconnectAttempts is 3)
      for (let i = 0; i < 4; i++) {
        streams.at(-1)?.emit("error", new Error(`Error ${i + 1}`));
        // Advance past the exponential backoff
        vi.advanceTimersByTime(10000);
      }
      expect(streams).toHaveLength(4);

      expect(ctx.emitHistory).toContainEqual(
        expect.objectContaining({
          event: "changestream:fallback",
          payload: expect.objectContaining({
            reason: expect.stringContaining("Exhausted"),
          }),
        }),
      );
    });

    it("preserves scheduled wakeups on stream error", () => {
      vi.useFakeTimers();

      handler.setup();

      // Schedule a wakeup timer via a future-dated job event
      const futureDate = new Date(Date.now() + 5000);
      stream.emit("change", {
        operationType: "insert",
        fullDocument: {
          name: "test-job",
          status: JobStatus.PENDING,
          nextRunAt: futureDate,
        },
      });

      stream.emit("error", new Error("Connection lost"));

      // Advance past when the wakeup would have fired
      vi.advanceTimersByTime(6000);

      expect(onPoll).toHaveBeenCalledOnce();
    });

    it("preserves batched notifications on stream error", () => {
      vi.useFakeTimers();

      handler.setup();

      // Trigger an event that starts the debounce timer
      stream.emit("change", {
        operationType: "insert",
        fullDocument: {
          name: "test-job",
          status: JobStatus.PENDING,
          nextRunAt: new Date(Date.now() - 1000),
        },
      });

      stream.emit("error", new Error("Connection lost"));

      // Advance past the debounce window (100ms)
      vi.advanceTimersByTime(150);

      expect(onPoll).toHaveBeenCalledOnce();
    });
  });

  describe("close", () => {
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
            void handler.close();
            handler.setup();
          }
          return true;
        });
        if (restartEvent === "changestream:error") stream.emit("error", new Error("Restart"));
        else await handler.close();
        await vi.advanceTimersByTimeAsync(1000);
        expect(ctx.collection.watch).toHaveBeenCalledTimes(2);
        const replacement = streams[1]!;
        expect(replacement.close).not.toHaveBeenCalled();
        replacement.emit("change", {
          operationType: "insert",
          fullDocument: { status: JobStatus.PENDING, name: "replacement" },
        });
        await vi.advanceTimersByTimeAsync(100);
        expect(onPoll).toHaveBeenCalledExactlyOnceWith(new Set(["replacement"]));
      },
    );

    it("ignores a closing stream while a replacement remains active", async () => {
      vi.useFakeTimers();
      const closed = Promise.withResolvers<void>();
      const oldStream = Object.assign(new EventEmitter(), {
        close: vi.fn().mockReturnValue(closed.promise),
      });
      const replacement = Object.assign(new EventEmitter(), {
        close: vi.fn().mockResolvedValue(undefined),
      });
      vi.spyOn(ctx.collection, "watch")
        .mockReturnValueOnce(oldStream as unknown as ReturnType<typeof ctx.collection.watch>)
        .mockReturnValue(replacement as unknown as ReturnType<typeof ctx.collection.watch>);
      handler.setup();
      const closing = handler.close();
      try {
        oldStream.emit("change", {
          operationType: "insert",
          fullDocument: { status: JobStatus.PENDING, name: "old" },
        });
        oldStream.emit("error", new Error("Closing cursor failed"));
        await vi.advanceTimersByTimeAsync(100);
        expect(onPoll).not.toHaveBeenCalled();
        expect(ctx.emitHistory).not.toContainEqual(
          expect.objectContaining({ event: "changestream:error" }),
        );

        handler.setup();
        closed.resolve();
        await closing;
        replacement.emit("change", {
          operationType: "insert",
          fullDocument: { status: JobStatus.PENDING, name: "replacement" },
        });
        await vi.advanceTimersByTimeAsync(100);
        expect(onPoll).toHaveBeenCalledExactlyOnceWith(new Set(["replacement"]));
        expect(replacement.close).not.toHaveBeenCalled();
      } finally {
        closed.resolve();
        await closing;
        await handler.close();
      }
      expect(replacement.close).toHaveBeenCalledOnce();
    });

    it("preserves replacement backoff when an earlier close completes", async () => {
      vi.useFakeTimers();
      const closed = Promise.withResolvers<void>();
      const streams = Array.from({ length: 5 }, (_, index) =>
        Object.assign(new EventEmitter(), {
          close: vi.fn().mockReturnValue(index === 0 ? closed.promise : Promise.resolve()),
        }),
      );
      const watch = vi.spyOn(ctx.collection, "watch");
      for (const stream of streams) {
        watch.mockReturnValueOnce(stream as unknown as ReturnType<typeof ctx.collection.watch>);
      }
      handler.setup();
      const closing = handler.close();
      try {
        handler.setup();
        streams[1]!.emit("error", new Error("First replacement failure"));
        closed.resolve();
        await closing;
        await vi.advanceTimersByTimeAsync(1000);
        expect(watch).toHaveBeenCalledTimes(3);

        streams[2]!.emit("error", new Error("Second replacement failure"));
        await vi.advanceTimersByTimeAsync(1999);
        expect(watch).toHaveBeenCalledTimes(3);
        await vi.advanceTimersByTimeAsync(1);
        expect(watch).toHaveBeenCalledTimes(4);

        streams[3]!.emit("error", new Error("Third replacement failure"));
        await vi.advanceTimersByTimeAsync(4000);
        streams[4]!.emit("error", new Error("Fourth replacement failure"));
        await vi.advanceTimersByTimeAsync(8000);
        expect(watch).toHaveBeenCalledTimes(5);
        expect(ctx.emitHistory).toContainEqual(
          expect.objectContaining({
            event: "changestream:fallback",
            payload: { reason: "Exhausted 3 reconnection attempts: Fourth replacement failure" },
          }),
        );
      } finally {
        closed.resolve();
        await closing;
        await handler.close();
      }
    });

    it("should close change stream and emit closed event", async () => {
      handler.setup();
      await handler.close();

      expect(stream.close).toHaveBeenCalled();
      expect(ctx.emitHistory).toContainEqual(
        expect.objectContaining({ event: "changestream:closed" }),
      );
    });

    it("preserves batched notifications when only the stream closes", async () => {
      vi.useFakeTimers();
      handler.setup();

      stream.emit("change", {
        operationType: "insert",
        fullDocument: { status: JobStatus.PENDING },
      });
      await handler.close();
      vi.advanceTimersByTime(150);

      expect(onPoll).toHaveBeenCalledOnce();
    });
  });

  describe("cursor changes - targeted polling", () => {
    beforeEach(() => handler.setup());

    it("should pass job name to onPoll for immediate jobs", () => {
      vi.useFakeTimers();
      const changeEvent = {
        operationType: "insert" as const,
        fullDocument: {
          status: JobStatus.PENDING,
          name: "email",
          nextRunAt: new Date(Date.now() - 1000),
        },
      };

      stream.emit("change", changeEvent);
      vi.advanceTimersByTime(150);

      expect(onPoll).toHaveBeenCalledOnce();
      expect(onPoll).toHaveBeenCalledWith(new Set(["email"]));
    });

    it("should collect multiple job names during debounce window", () => {
      vi.useFakeTimers();
      const pastDate = new Date(Date.now() - 1000);

      stream.emit("change", {
        operationType: "insert",
        fullDocument: { status: JobStatus.PENDING, name: "email", nextRunAt: pastDate },
      });

      vi.advanceTimersByTime(50);

      stream.emit("change", {
        operationType: "insert",
        fullDocument: { status: JobStatus.PENDING, name: "sms", nextRunAt: pastDate },
      });

      vi.advanceTimersByTime(150);

      expect(onPoll).toHaveBeenCalledOnce();
      expect(onPoll).toHaveBeenCalledWith(new Set(["email", "sms"]));
    });

    it("should fall back to full poll when fullDocument has no name", () => {
      vi.useFakeTimers();
      const changeEvent = {
        operationType: "insert" as const,
        fullDocument: { status: JobStatus.PENDING },
      };

      stream.emit("change", changeEvent);
      vi.advanceTimersByTime(150);

      expect(onPoll).toHaveBeenCalledOnce();
      // No target names — falls back to full poll with undefined
      expect(onPoll).toHaveBeenCalledWith(undefined);
    });

    it("should trigger poll on update event with status change to pending", () => {
      vi.useFakeTimers();
      const pastDate = new Date(Date.now() - 1000);
      const changeEvent = {
        operationType: "update" as const,
        fullDocument: {
          status: JobStatus.PENDING,
          name: "retry-job",
          nextRunAt: pastDate,
        },
        updateDescription: { updatedFields: { status: JobStatus.PENDING } },
      };

      stream.emit("change", changeEvent);
      vi.advanceTimersByTime(150);

      expect(onPoll).toHaveBeenCalledOnce();
      expect(onPoll).toHaveBeenCalledWith(new Set(["retry-job"]));
    });
  });

  describe("cursor changes - future job wakeup", () => {
    beforeEach(() => handler.setup());

    it("should schedule wakeup timer for future jobs", () => {
      vi.useFakeTimers();
      const futureDate = new Date(Date.now() + 5000);
      const changeEvent = {
        operationType: "insert" as const,
        fullDocument: {
          status: JobStatus.PENDING,
          name: "scheduled",
          nextRunAt: futureDate,
        },
      };

      stream.emit("change", changeEvent);

      // Should NOT have polled immediately
      vi.advanceTimersByTime(150);
      expect(onPoll).not.toHaveBeenCalled();

      // Should NOT fire before delay + grace period (5000 + 200 = 5200ms)
      vi.advanceTimersByTime(4900);
      expect(onPoll).not.toHaveBeenCalled();

      // Should fire after the grace period
      vi.advanceTimersByTime(200);
      expect(onPoll).toHaveBeenCalledOnce();
    });

    it("should use earliest nextRunAt when multiple future jobs arrive", () => {
      vi.useFakeTimers();

      // First job at +10s
      stream.emit("change", {
        operationType: "insert",
        fullDocument: {
          status: JobStatus.PENDING,
          name: "late",
          nextRunAt: new Date(Date.now() + 10000),
        },
      });

      // Second job at +3s (earlier — should replace timer)
      stream.emit("change", {
        operationType: "insert",
        fullDocument: {
          status: JobStatus.PENDING,
          name: "early",
          nextRunAt: new Date(Date.now() + 3000),
        },
      });

      // Should fire at ~3200ms, not 10200ms
      vi.advanceTimersByTime(3200);
      expect(onPoll).toHaveBeenCalledOnce();
    });

    it("should not replace timer when later job arrives", () => {
      vi.useFakeTimers();

      // First job at +3s
      stream.emit("change", {
        operationType: "insert",
        fullDocument: {
          status: JobStatus.PENDING,
          name: "early",
          nextRunAt: new Date(Date.now() + 3000),
        },
      });

      // Second job at +10s (later — should NOT replace timer)
      stream.emit("change", {
        operationType: "insert",
        fullDocument: {
          status: JobStatus.PENDING,
          name: "late",
          nextRunAt: new Date(Date.now() + 10000),
        },
      });

      // Should still fire at ~3200ms
      vi.advanceTimersByTime(3200);
      expect(onPoll).toHaveBeenCalledOnce();
    });

    it("should check the scheduled job name when its wakeup fires", () => {
      vi.useFakeTimers();
      stream.emit("change", {
        operationType: "insert",
        fullDocument: {
          status: JobStatus.PENDING,
          name: "scheduled",
          nextRunAt: new Date(Date.now() + 1000),
        },
      });

      vi.advanceTimersByTime(1200);

      expect(onPoll).toHaveBeenCalledOnce();
      expect(onPoll).toHaveBeenCalledWith(new Set(["scheduled"]));
    });

    it("preserves scheduled wakeups when only the stream closes", async () => {
      vi.useFakeTimers();
      stream.emit("change", {
        operationType: "insert",
        fullDocument: {
          status: JobStatus.PENDING,
          name: "scheduled",
          nextRunAt: new Date(Date.now() + 5000),
        },
      });

      await handler.close();

      // Advance past the wakeup time
      vi.advanceTimersByTime(6000);
      expect(onPoll).toHaveBeenCalledOnce();
    });
  });

  describe("cursor changes - mixed immediate and future", () => {
    beforeEach(() => handler.setup());

    it("should handle immediate and future jobs independently", () => {
      vi.useFakeTimers();
      const pastDate = new Date(Date.now() - 1000);

      // Immediate job — triggers targeted debounced poll
      stream.emit("change", {
        operationType: "insert",
        fullDocument: {
          status: JobStatus.PENDING,
          name: "immediate",
          nextRunAt: pastDate,
        },
      });

      // Future job — schedules wakeup
      stream.emit("change", {
        operationType: "insert",
        fullDocument: {
          status: JobStatus.PENDING,
          name: "future",
          nextRunAt: new Date(Date.now() + 5000),
        },
      });

      // Debounced poll fires for the immediate job
      vi.advanceTimersByTime(150);
      expect(onPoll).toHaveBeenCalledOnce();
      expect(onPoll).toHaveBeenCalledWith(new Set(["immediate"]));

      // Wakeup fires for the future job
      vi.advanceTimersByTime(5200);
      expect(onPoll).toHaveBeenCalledTimes(2);
    });
  });

  describe("cursor changes - slot freed (completed/failed)", () => {
    beforeEach(() => handler.setup());

    it("should trigger targeted poll when job status changes to completed", () => {
      vi.useFakeTimers();

      stream.emit("change", {
        operationType: "update",
        updateDescription: { updatedFields: { status: "completed" } },
        fullDocument: {
          status: JobStatus.COMPLETED,
          name: "email",
          nextRunAt: new Date(),
        },
      });

      vi.advanceTimersByTime(150);
      expect(onPoll).toHaveBeenCalledOnce();
      expect(onPoll).toHaveBeenCalledWith(new Set(["email"]));
    });

    it("should trigger targeted poll when job status changes to failed", () => {
      vi.useFakeTimers();

      stream.emit("change", {
        operationType: "update",
        updateDescription: { updatedFields: { status: "failed" } },
        fullDocument: {
          status: JobStatus.FAILED,
          name: "sms",
          nextRunAt: new Date(),
        },
      });

      vi.advanceTimersByTime(150);
      expect(onPoll).toHaveBeenCalledOnce();
      expect(onPoll).toHaveBeenCalledWith(new Set(["sms"]));
    });

    it("should coalesce slot-freed events with insert events during debounce", () => {
      vi.useFakeTimers();

      // Insert event for a new pending job
      stream.emit("change", {
        operationType: "insert",
        fullDocument: {
          status: JobStatus.PENDING,
          name: "email",
          nextRunAt: new Date(Date.now() - 1000),
        },
      });

      // Slot freed by completed job for same worker
      stream.emit("change", {
        operationType: "update",
        updateDescription: { updatedFields: { status: "completed" } },
        fullDocument: {
          status: JobStatus.COMPLETED,
          name: "email",
          nextRunAt: new Date(),
        },
      });

      vi.advanceTimersByTime(150);
      // Single debounced poll with the worker name
      expect(onPoll).toHaveBeenCalledOnce();
      expect(onPoll).toHaveBeenCalledWith(new Set(["email"]));
    });

    it("should fall back to full poll when completed event has no name", () => {
      vi.useFakeTimers();

      stream.emit("change", {
        operationType: "update",
        updateDescription: { updatedFields: { status: "completed" } },
        fullDocument: {
          status: JobStatus.COMPLETED,
        },
      });

      vi.advanceTimersByTime(150);
      expect(onPoll).toHaveBeenCalledOnce();
      expect(onPoll).toHaveBeenCalledWith(undefined);
    });

    it("should not trigger on status change to processing", () => {
      vi.useFakeTimers();

      stream.emit("change", {
        operationType: "update",
        updateDescription: { updatedFields: { status: "processing" } },
        fullDocument: {
          status: JobStatus.PROCESSING,
          name: "email",
          nextRunAt: new Date(),
        },
      });

      vi.advanceTimersByTime(150);
      expect(onPoll).not.toHaveBeenCalled();
    });
  });

  describe("cursor changes - error handling", () => {
    beforeEach(() => handler.setup());

    it("should emit job:error if poll throws", async () => {
      vi.useFakeTimers();
      const pollError = new Error("Poll failed");
      vi.mocked(onPoll).mockRejectedValue(pollError);

      const changeEvent = {
        operationType: "insert" as const,
        fullDocument: { status: JobStatus.PENDING },
      };

      stream.emit("change", changeEvent);
      vi.advanceTimersByTime(150);

      // Wait for the promise rejection to be handled
      await vi.runAllTimersAsync();

      expect(ctx.emitHistory).toContainEqual(
        expect.objectContaining({
          event: "job:error",
          payload: expect.objectContaining({ error: pollError }),
        }),
      );
    });
  });

  describe("close with active timers", () => {
    it("should clear reconnect timer during close", async () => {
      vi.useFakeTimers();

      handler.setup();

      // Trigger an error to start reconnect timer
      stream.emit("error", new Error("Connection lost"));

      // Close before reconnect timer fires
      await handler.close();

      // Advance past the reconnect delay to verify timer was cleared
      vi.advanceTimersByTime(5000);

      // Should not have tried to setup again
      expect(ctx.collection.watch).toHaveBeenCalledOnce();
    });
  });
});
