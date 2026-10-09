import { EventEmitter } from "node:events";
import { setImmediate as yieldImmediate } from "node:timers/promises";
import { fromPartial } from "@total-typescript/shoehorn";
import { ObjectId } from "mongodb";
import type { Db, Collection } from "mongodb";
import { describe, expect, it, vi } from "vite-plus/test";

import type { MonqueEventMap } from "@/events";
import { Monque } from "@/scheduler/monque.js";
import type { WorkerRegistration } from "@/workers";
import { nativeAsyncMock } from "@tests/setup/native-async-mock.js";

describe("background listener rejection delivery", () => {
  it.each(["heartbeat", "worker", "cleanup", "poll"])(
    "exposes a throwing %s error listener as the original unhandled rejection",
    async (mode) => {
      const listenerError = new Error("Job error listener failed");
      const sourceError = new Error("Background operation failed");
      const release: PromiseWithResolvers<void> = Promise.withResolvers();
      // oxlint-disable-next-line unicorn/prefer-event-target -- Mongo ChangeStream uses Node EventEmitter methods and synchronous event callbacks.
      const stream = Object.assign(new EventEmitter(), { close: async () => {} });
      const job = {
        _id: new ObjectId(),
        name: "work",
        data: {},
        status: "processing",
        claimId: "claim",
        claimedBy: "instance",
        failCount: 0,
        nextRunAt: new Date(0),
        createdAt: new Date(0),
        updatedAt: new Date(0),
      };
      let claims = 0;
      let heartbeats = 0;
      const collection = {
        options: nativeAsyncMock<Collection["options"]>(() => ({})),
        findOne: nativeAsyncMock<Collection["findOne"]>(() => null),
        findOneAndUpdate: nativeAsyncMock<Collection["findOneAndUpdate"]>(() => {
          claims += 1;
          if (claims === 1) {
            return job;
          }
          if (mode === "worker") {
            throw sourceError;
          }
          return null;
        }),
        aggregate: () => ({
          toArray: nativeAsyncMock<ReturnType<Collection["aggregate"]>["toArray"]>(() => {
            if (mode === "poll") {
              throw sourceError;
            }
            return [{ _id: "work", nextRunAt: new Date(0) }];
          }),
        }),
        watch: () => stream,
        deleteMany: vi.fn<Collection["deleteMany"]>().mockRejectedValue(sourceError),
        updateMany: nativeAsyncMock<Collection["updateMany"]>((filter) => {
          const heartbeat = !("priority" in filter);
          if (heartbeat) {
            heartbeats += 1;
          }
          if (heartbeat && heartbeats === 1 && mode === "heartbeat") {
            throw sourceError;
          }
          return {
            acknowledged: true,
            matchedCount: 1,
            modifiedCount: 0,
            upsertedCount: 0,
            upsertedId: null,
          };
        }),
      };
      const retention = mode === "cleanup" ? { completed: 60_000, interval: 100_000 } : undefined;
      const monque = new Monque(fromPartial<Db>({ collection: () => collection }), {
        skipIndexCreation: true,
        recoverStaleJobs: false,
        heartbeatInterval: 5,
        pollInterval: 100_000,
        safetyPollInterval: 100_000,
        workerConcurrency: 1,
        schedulerInstanceId: "instance",
        jobRetention: retention,
      });
      const rejections: unknown[] = [];
      const onUnhandledRejection: NodeJS.UnhandledRejectionListener = (error) => {
        rejections.push(error);
      };
      const onJobError = vi.fn<(event: MonqueEventMap["job:error"]) => void>(() => {
        throw listenerError;
      });
      const worker = vi.fn<WorkerRegistration["handler"]>(async () => {
        await release.promise;
      });
      monque.on("job:error", onJobError);
      monque.register("work", worker);
      process.on("unhandledRejection", onUnhandledRejection);
      try {
        await monque.initialize();
        monque.start();
        await vi.waitFor(() => {
          expect(worker).toHaveBeenCalledTimes(mode === "poll" ? 0 : 1);
        });
        if (mode === "worker") {
          release.resolve();
        }
        await vi.waitFor(() => {
          expect(rejections).toHaveLength(1);
        });
      } finally {
        release.resolve();
        try {
          await monque.stop();
          await yieldImmediate();
        } finally {
          process.off("unhandledRejection", onUnhandledRejection);
        }
      }
      expect({
        rejectionsLength: rejections.length,
        rejections0: Object.is(rejections[0], listenerError),
        onJobErrorMockCallsLength: onJobError.mock.calls.length,
      }).toStrictEqual({
        rejectionsLength: 1,
        rejections0: true,
        onJobErrorMockCallsLength: 1,
      });
    },
  );
});
