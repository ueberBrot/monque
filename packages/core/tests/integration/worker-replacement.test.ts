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
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const order: string[] = [];
      monque.register("work", async () => {
        started.resolve();
        await release.promise;
        order.push("original");
        if (fail) throw new Error("Original handler failed");
      });
      const original = await monque.enqueue("work", {});
      monque.start();
      try {
        await started.promise;
        monque.register(
          "work",
          async () => {
            order.push("replacement");
          },
          { replace: true },
        );
        monque.register(
          "work",
          async () => {
            order.push("latest");
          },
          { replace: true },
        );
        expect((await monque.getQueueViewSummaries())[0]?.worker).toMatchObject({
          activeCount: 1,
          concurrency: 1,
        });
        const next = await monque.enqueue("work", {});
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect((await monque.getJob(next._id))?.status).toBe(JobStatus.PENDING);
        release.resolve();
        await waitFor(async () => (await monque.getJob(next._id))?.status === JobStatus.COMPLETED);
        await monque.stop();
        expect(order).toEqual(["original", "latest"]);
        expect((await monque.getJob(original._id))?.status).toBe(
          fail ? JobStatus.FAILED : JobStatus.COMPLETED,
        );
        expect((await monque.getQueueViewSummaries())[0]?.worker?.activeCount).toBe(0);
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
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    monque.register("work", async () => {
      started.resolve();
      await release.promise;
    });
    const job = await monque.enqueue("work", {});
    monque.start();
    let stopped = false;
    try {
      await started.promise;
      monque.register("work", async () => {}, { replace: true });
      const stopping = monque.stop().then(() => {
        stopped = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(stopped).toBe(false);
      release.resolve();
      await stopping;
      expect((await monque.getJob(job._id))?.status).toBe(JobStatus.COMPLETED);
    } finally {
      release.resolve();
      await waitFor(async () => (await monque.getJob(job._id))?.status === JobStatus.COMPLETED);
      await monque.stop();
    }
  });
});
