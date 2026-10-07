import { EventEmitter } from "node:events";
import { type Db, ObjectId } from "mongodb";
import { expect, it, vi } from "vite-plus/test";

import { Monque } from "@/scheduler/monque.js";

it.each(["heartbeat", "worker", "cleanup", "poll"])(
  "exposes a throwing %s error listener as the original unhandled rejection",
  async (mode) => {
    const listenerError = new Error("Job error listener failed");
    const sourceError = new Error("Background operation failed");
    const release = Promise.withResolvers<void>();
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
      options: async () => ({}),
      findOne: async () => null,
      findOneAndUpdate: async () => {
        if (++claims === 1) return job;
        if (mode === "worker") throw sourceError;
        return null;
      },
      aggregate: () => ({
        toArray: async () => {
          if (mode === "poll") throw sourceError;
          return [{ _id: "work", nextRunAt: new Date(0) }];
        },
      }),
      watch: () => stream,
      deleteMany: async () => {
        throw sourceError;
      },
      updateMany: async (filter: Record<string, unknown>) => {
        if (!("priority" in filter) && ++heartbeats === 1 && mode === "heartbeat")
          throw sourceError;
        return { acknowledged: true, matchedCount: 1, modifiedCount: 0 };
      },
    };
    const monque = new Monque({ collection: () => collection } as unknown as Db, {
      skipIndexCreation: true,
      recoverStaleJobs: false,
      heartbeatInterval: 5,
      pollInterval: 100000,
      safetyPollInterval: 100000,
      workerConcurrency: 1,
      schedulerInstanceId: "instance",
      ...(mode === "cleanup" ? { jobRetention: { completed: 60000, interval: 100000 } } : {}),
    });
    const rejections: unknown[] = [];
    const onUnhandledRejection = (error: unknown) => {
      rejections.push(error);
    };
    const onJobError = vi.fn(() => {
      throw listenerError;
    });
    const worker = vi.fn(async () => {
      await release.promise;
    });
    monque.on("job:error", onJobError);
    monque.register("work", worker);
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      await monque.initialize();
      monque.start();
      if (mode !== "poll") {
        await vi.waitFor(() => expect(worker).toHaveBeenCalledOnce());
      }
      if (mode === "worker") release.resolve();
      await vi.waitFor(() => expect(rejections).toHaveLength(1));
    } finally {
      release.resolve();
      try {
        await monque.stop();
        await new Promise<void>((resolve) => setImmediate(resolve));
      } finally {
        process.off("unhandledRejection", onUnhandledRejection);
      }
    }

    expect(rejections).toHaveLength(1);
    expect(rejections[0]).toBe(listenerError);
    expect(onJobError).toHaveBeenCalledOnce();
  },
);
