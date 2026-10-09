import { setTimeout as pauseFor } from "node:timers/promises";
import type { Db } from "mongodb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";

import { JobStatus, Monque } from "@/index";
import {
  cleanupTestDb,
  getTestDb,
  stopMonqueInstances,
  uniqueCollectionName,
  waitFor,
} from "@test-utils/test-utils";

describe("replacing a running worker", () => {
  let db: Db;
  const instances: Monque[] = [];
  beforeAll(async () => {
    db = await getTestDb("worker-replacement");
  });
  afterEach(async () => {
    await stopMonqueInstances(instances);
  });

  afterAll(async () => {
    await cleanupTestDb(db);
  });

  it.each([false, true])(
    "keeps active jobs visible until they finish (failure: %s)",
    async (fail) => {
      const monque = new Monque(db, {
        collectionName: uniqueCollectionName("replacement"),
        workerConcurrency: 1,
        maxRetries: 1,
        pollInterval: 20,
        safetyPollInterval: 20,
      });
      instances.push(monque);
      await monque.initialize();
      const started: PromiseWithResolvers<void> = Promise.withResolvers();
      const release: PromiseWithResolvers<void> = Promise.withResolvers();
      const order: string[] = [];
      monque.register("work", async () => {
        started.resolve();
        await release.promise;
        order.push("original");
        if (fail) {
          throw new Error("Original handler failed");
        }
      });
      const original = await monque.enqueue("work", {});
      monque.start();
      try {
        await started.promise;
        monque.register(
          "work",
          () => {
            order.push("replacement");
          },
          { replace: true },
        );
        monque.register(
          "work",
          () => {
            order.push("latest");
          },
          { replace: true },
        );
        const awaitedResult1 = await monque.getQueueViewSummaries();
        expect(awaitedResult1[0]?.worker).toMatchObject({
          activeCount: 1,
          concurrency: 1,
        });
        const next = await monque.enqueue("work", {});
        await pauseFor(100);
        const awaitedResult2 = await monque.getJob(next._id);
        expect(awaitedResult2?.status).toBe(JobStatus.PENDING);
        release.resolve();
        await waitFor(async () => {
          const awaitedResult3 = await monque.getJob(next._id);
          return awaitedResult3?.status === JobStatus.COMPLETED;
        });
        await monque.stop();
        expect(order).toStrictEqual(["original", "latest"]);
        const awaitedResult4 = await monque.getJob(original._id);
        expect(awaitedResult4?.status).toBe(fail ? JobStatus.FAILED : JobStatus.COMPLETED);
        const awaitedResult5 = await monque.getQueueViewSummaries();
        expect(awaitedResult5[0]?.worker?.activeCount).toBe(0);
      } finally {
        release.resolve();
        await monque.stop();
      }
    },
  );

  it("drains the original handler during shutdown after replacement", async () => {
    const monque = new Monque(db, { collectionName: uniqueCollectionName("drain") });
    instances.push(monque);
    await monque.initialize();
    const started: PromiseWithResolvers<void> = Promise.withResolvers();
    const release: PromiseWithResolvers<void> = Promise.withResolvers();
    monque.register("work", async () => {
      started.resolve();
      await release.promise;
    });
    const job = await monque.enqueue("work", {});
    monque.start();
    let stopped = false;
    try {
      await started.promise;
      monque.register("work", () => {}, { replace: true });
      const stopping = monque.stop().then(() => {
        stopped = true;
      });
      await pauseFor(100);
      expect(stopped).toBe(false);
      release.resolve();
      await stopping;
      const awaitedResult6 = await monque.getJob(job._id);
      expect(awaitedResult6?.status).toBe(JobStatus.COMPLETED);
    } finally {
      release.resolve();
      await waitFor(async () => {
        const awaitedResult7 = await monque.getJob(job._id);
        return awaitedResult7?.status === JobStatus.COMPLETED;
      });
      await monque.stop();
    }
  });
});
