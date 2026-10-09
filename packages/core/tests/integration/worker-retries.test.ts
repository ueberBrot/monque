import type { Db } from "mongodb";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { JobStatus, Monque } from "@/index";
import {
  cleanupTestDb,
  getTestDb,
  stopMonqueInstances,
  uniqueCollectionName,
  waitFor,
} from "@test-utils/test-utils";

describe("worker retry options", () => {
  let db: Db;
  const instances: Monque[] = [];
  beforeAll(async () => {
    db = await getTestDb("worker-retries");
  });
  afterEach(async () => {
    await stopMonqueInstances(instances);
  });

  afterAll(async () => {
    await cleanupTestDb(db);
  });

  it("applies independent failure limits while other workers inherit defaults", async () => {
    const monque = new Monque(db, {
      collectionName: uniqueCollectionName("retry-options"),
      maxRetries: 1,
      baseRetryInterval: 0,
      pollInterval: 20,
      safetyPollInterval: 20,
    });
    instances.push(monque);
    await monque.initialize();
    const fail = vi.fn<() => Promise<void>>().mockRejectedValue(new Error("Unavailable"));
    const customOptions = { maxRetries: 2, concurrency: 1 };
    monque.register("custom", fail, customOptions);
    monque.register("default", fail);
    const custom = await monque.enqueue("custom", {});
    const inherited = await monque.enqueue("default", {});
    monque.start();
    await waitFor(async () => {
      const [customJob, inheritedJob] = await Promise.all([
        monque.getJob(custom._id),
        monque.getJob(inherited._id),
      ]);
      return customJob?.status === JobStatus.FAILED && inheritedJob?.status === JobStatus.FAILED;
    });
    const awaitedResult1 = await monque.getJob(custom._id);
    expect(awaitedResult1?.failCount).toBe(2);
    const awaitedResult2 = await monque.getJob(inherited._id);
    expect(awaitedResult2?.failCount).toBe(1);
  });

  it.each([
    { options: { baseRetryInterval: 1000 }, min: 1500, max: 2500 },
    { options: { maxBackoffDelay: 1000 }, min: 750, max: 1000 },
  ])("uses worker backoff settings $options", async ({ options, min, max }) => {
    const monque = new Monque(db, {
      collectionName: uniqueCollectionName("backoff-options"),
      baseRetryInterval: 20_000,
    });
    instances.push(monque);
    await monque.initialize();
    monque.register(
      "work",
      () => {
        throw new Error("Unavailable");
      },
      options,
    );
    const failure = Promise.withResolvers<{
      nextRunAt: Date;
      updatedAt: Date;
    }>();
    monque.once("job:fail", ({ job }) => {
      failure.resolve(job);
    });
    await monque.enqueue("work", {});
    monque.start();
    const job = await failure.promise;
    await monque.stop();
    const delay = job.nextRunAt.getTime() - job.updatedAt.getTime();
    expect(delay).toBeGreaterThanOrEqual(min);
    expect(delay).toBeLessThanOrEqual(max + 50);
  });

  it("keeps the retry policy of an execution when its worker is replaced", async () => {
    const monque = new Monque(db, {
      collectionName: uniqueCollectionName("retry-replacement"),
      baseRetryInterval: 0,
      pollInterval: 20,
      safetyPollInterval: 20,
    });
    instances.push(monque);
    await monque.initialize();
    const started: PromiseWithResolvers<void> = Promise.withResolvers();
    const release: PromiseWithResolvers<void> = Promise.withResolvers();
    monque.register(
      "work",
      async () => {
        started.resolve();
        await release.promise;
        throw new Error("Original failure");
      },
      { maxRetries: 1 },
    );
    const job = await monque.enqueue("work", {});
    monque.start();
    try {
      await started.promise;
      monque.register(
        "work",
        () => {
          throw new Error("Replacement failure");
        },
        {
          replace: true,
          maxRetries: 5,
        },
      );
      release.resolve();
      await waitFor(async () => {
        const awaitedResult3 = await monque.getJob(job._id);
        return awaitedResult3?.status === JobStatus.FAILED;
      });
      await expect(monque.getJob(job._id)).resolves.toMatchObject({
        failCount: 1,
        failReason: "Original failure",
      });
    } finally {
      release.resolve();
    }
  });
});
