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

describe("claim ownership", () => {
  let db: Db;
  const instances: Monque[] = [];
  beforeAll(async () => {
    db = await getTestDb("claim-ownership");
  });
  afterEach(async () => {
    await stopMonqueInstances(instances);
  });

  afterAll(async () => {
    await cleanupTestDb(db);
  });

  it.each([false, true])(
    "ignores a late result after the same instance ID reclaims a job (failure: %s)",
    async (fail) => {
      const options = {
        collectionName: uniqueCollectionName("claim"),
        schedulerInstanceId: "reused-instance",
        workerConcurrency: 1,
        pollInterval: 20,
        safetyPollInterval: 20,
        shutdownTimeout: 1,
        maxRetries: 1,
      };
      const original = new Monque(db, options);
      const replacement = new Monque(db, { ...options, lockTimeout: 0 });
      instances.push(original, replacement);
      await original.initialize();
      const firstStarted: PromiseWithResolvers<void> = Promise.withResolvers();
      const secondStarted: PromiseWithResolvers<void> = Promise.withResolvers();
      const firstRelease: PromiseWithResolvers<void> = Promise.withResolvers();
      const secondRelease: PromiseWithResolvers<void> = Promise.withResolvers();
      const completed = vi.fn<() => void>();
      const failed = vi.fn<() => void>();
      original.on("job:complete", completed);
      original.on("job:fail", failed);
      original.register("work", async () => {
        firstStarted.resolve();
        await firstRelease.promise;
        if (fail) {
          throw new Error("Late failure");
        }
      });
      replacement.register("work", async () => {
        secondStarted.resolve();
        await secondRelease.promise;
      });
      const job = await original.enqueue("work", {});
      original.start();
      try {
        await firstStarted.promise;
        await original.stop();
        await replacement.initialize();
        replacement.start();
        await secondStarted.promise;
        firstRelease.resolve();
        await waitFor(async () => {
          const awaitedResult1 = await original.getQueueViewSummaries();
          return awaitedResult1[0]?.worker?.activeCount === 0;
        });
        const awaitedResult2 = await replacement.getJob(job._id);
        expect(awaitedResult2?.status).toBe(JobStatus.PROCESSING);
        expect(completed).not.toHaveBeenCalled();
        expect(failed).not.toHaveBeenCalled();
        secondRelease.resolve();
        await waitFor(async () => {
          const awaitedResult3 = await replacement.getJob(job._id);
          return awaitedResult3?.status === JobStatus.COMPLETED;
        });
      } finally {
        firstRelease.resolve();
        secondRelease.resolve();
        await waitFor(async () => {
          const awaitedResult4 = await original.getQueueViewSummaries();
          return awaitedResult4[0]?.worker?.activeCount === 0;
        });
        await replacement.stop();
      }
    },
  );

  it("retains both executions when the same scheduler reclaims a recovered job", async () => {
    const collectionName = uniqueCollectionName("overlapping-claims");
    const monque = new Monque(db, {
      collectionName,
      workerConcurrency: 2,
      heartbeatInterval: 20,
      pollInterval: 20,
      safetyPollInterval: 20,
    });
    const recovery = new Monque(db, { collectionName, lockTimeout: 0 });
    instances.push(monque, recovery);
    await monque.initialize();
    const firstStarted: PromiseWithResolvers<void> = Promise.withResolvers();
    const secondStarted: PromiseWithResolvers<void> = Promise.withResolvers();
    const firstRelease: PromiseWithResolvers<void> = Promise.withResolvers();
    const secondRelease: PromiseWithResolvers<void> = Promise.withResolvers();
    let executions = 0;
    monque.register("work", async () => {
      if ((executions += 1) === 1) {
        firstStarted.resolve();
        await firstRelease.promise;
      } else {
        secondStarted.resolve();
        await secondRelease.promise;
      }
    });
    const job = await monque.enqueue("work", {});
    monque.start();
    try {
      await firstStarted.promise;
      await recovery.initialize();
      await secondStarted.promise;
      const awaitedResult5 = await monque.getQueueViewSummaries();
      expect(awaitedResult5[0]?.worker?.activeCount).toBe(2);
      firstRelease.resolve();
      await waitFor(async () => {
        const awaitedResult6 = await monque.getQueueViewSummaries();
        return awaitedResult6[0]?.worker?.activeCount === 1;
      });
      const awaitedResult7 = await monque.getJob(job._id);
      const heartbeat = awaitedResult7?.lastHeartbeat;
      await waitFor(async () => {
        const awaitedResult8 = await monque.getJob(job._id);
        const current = awaitedResult8?.lastHeartbeat;
        return current instanceof Date && heartbeat instanceof Date && current > heartbeat;
      });
      const awaitedResult9 = await monque.getJob(job._id);
      expect(awaitedResult9?.status).toBe(JobStatus.PROCESSING);
    } finally {
      firstRelease.resolve();
      secondRelease.resolve();
      await monque.stop();
    }
    const awaitedResult10 = await monque.getJob(job._id);
    expect(awaitedResult10?.status).toBe(JobStatus.COMPLETED);
  });

  it("does not send heartbeats for a replacement claim with the same instance ID", async () => {
    const options = {
      collectionName: uniqueCollectionName("heartbeat-claim"),
      schedulerInstanceId: "reused-instance",
      workerConcurrency: 1,
      pollInterval: 20,
      safetyPollInterval: 20,
    };
    const original = new Monque(db, { ...options, heartbeatInterval: 20 });
    const replacement = new Monque(db, { ...options, lockTimeout: 0, heartbeatInterval: 30_000 });
    instances.push(original, replacement);
    await original.initialize();
    const firstStarted: PromiseWithResolvers<void> = Promise.withResolvers();
    const secondStarted: PromiseWithResolvers<void> = Promise.withResolvers();
    const probeStarted: PromiseWithResolvers<void> = Promise.withResolvers();
    const release: PromiseWithResolvers<void> = Promise.withResolvers();
    original.register("work", async () => {
      firstStarted.resolve();
      await release.promise;
    });
    replacement.register("work", async () => {
      secondStarted.resolve();
      await release.promise;
    });
    original.register("probe", async () => {
      probeStarted.resolve();
      await release.promise;
    });
    const job = await original.enqueue("work", {});
    original.start();
    try {
      await firstStarted.promise;
      await replacement.initialize();
      replacement.start();
      await secondStarted.promise;
      const awaitedResult11 = await replacement.getJob(job._id);
      const heartbeat = awaitedResult11?.lastHeartbeat;
      expect(heartbeat).toBeInstanceOf(Date);
      const probe = await original.enqueue("probe", {});
      await probeStarted.promise;
      const awaitedResult12 = await original.getJob(probe._id);
      const probeHeartbeat = awaitedResult12?.lastHeartbeat;
      await waitFor(async () => {
        const awaitedResult13 = await original.getJob(probe._id);
        const current = awaitedResult13?.lastHeartbeat;
        return (
          current instanceof Date && probeHeartbeat instanceof Date && current > probeHeartbeat
        );
      });
      const awaitedResult14 = await replacement.getJob(job._id);
      expect(awaitedResult14?.lastHeartbeat).toStrictEqual(heartbeat);
    } finally {
      release.resolve();
      await stopMonqueInstances(instances);
    }
  });
});
