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

import { forEachSequential } from "./helpers";

describe("renewable leases", () => {
  let db: Db;
  const instances: Monque[] = [];
  beforeAll(async () => {
    db = await getTestDb("renewable-leases");
  });
  afterEach(async () => {
    await stopMonqueInstances(instances);
  });

  afterAll(async () => {
    await cleanupTestDb(db);
  });

  it("recovers abandoned work without restarting a surviving scheduler", async () => {
    const options = {
      collectionName: uniqueCollectionName("continuous-recovery"),
      leaseDuration: 500,
      heartbeatInterval: 20,
      shutdownTimeout: 1,
      pollInterval: 20,
      safetyPollInterval: 20,
    };
    const owner = new Monque(db, options);
    const survivor = new Monque(db, options);
    instances.push(owner, survivor);
    await owner.initialize();
    await survivor.initialize();
    const started: PromiseWithResolvers<void> = Promise.withResolvers();
    const release: PromiseWithResolvers<void> = Promise.withResolvers();
    owner.register("work", async () => {
      started.resolve();
      await release.promise;
    });
    survivor.start();
    const job = await owner.enqueue("work", {});
    owner.start();
    try {
      await started.promise;
      await owner.stop();
      survivor.register("work", () => {});
      await waitFor(async () => {
        const awaitedResult1 = await survivor.getJob(job._id);
        return awaitedResult1?.status === JobStatus.COMPLETED;
      });
      await expect(survivor.getJob(job._id)).resolves.toMatchObject({
        status: JobStatus.COMPLETED,
      });
    } finally {
      release.resolve();
      await survivor.stop();
      await waitFor(async () => {
        const awaitedResult2 = await owner.getQueueViewSummaries();
        return awaitedResult2[0]?.worker?.activeCount === 0;
      });
    }
  });

  it.each([false, true])(
    "does not revive an expired lease or accept its late result (failure: %s)",
    async (fail) => {
      const collectionName = uniqueCollectionName("expired-lease");
      const owner = new Monque(db, {
        collectionName,
        leaseDuration: 30_000,
        heartbeatInterval: 20,
        shutdownTimeout: 1,
        recoverStaleJobs: false,
        pollInterval: 20,
        safetyPollInterval: 20,
      });
      instances.push(owner);
      await owner.initialize();
      const started: PromiseWithResolvers<void> = Promise.withResolvers();
      const probeStarted: PromiseWithResolvers<void> = Promise.withResolvers();
      const release: PromiseWithResolvers<void> = Promise.withResolvers();
      owner.register("work", async () => {
        started.resolve();
        await release.promise;
        if (fail) {
          throw new Error("Expired handler failed");
        }
      });
      owner.register("probe", async () => {
        probeStarted.resolve();
        await release.promise;
      });
      const job = await owner.enqueue("work", {});
      owner.start();
      try {
        await started.promise;
        await owner.stop();
        // Establish expiry atomically; a heartbeat started before stop() may still be in flight.
        const deadline = new Date(0);
        await db
          .collection(collectionName)
          .updateOne({ _id: job._id }, { $set: { leaseExpiresAt: deadline } });
        owner.start();
        const probe = await owner.enqueue("probe", {});
        await probeStarted.promise;
        const awaitedResult3 = await owner.getJob(probe._id);
        const previous = awaitedResult3?.lastHeartbeat;
        await waitFor(async () => {
          const awaitedResult4 = await owner.getJob(probe._id);
          const current = awaitedResult4?.lastHeartbeat;
          return current instanceof Date && previous instanceof Date && current > previous;
        });
        const awaitedResult5 = await owner.getJob(job._id);
        expect(awaitedResult5?.leaseExpiresAt).toStrictEqual(deadline);
        release.resolve();
        await waitFor(async () => {
          const awaitedResult6 = await owner.getQueueViewSummaries();
          return awaitedResult6.every((view) => view.worker?.activeCount === 0);
        });
        await expect(owner.getJob(job._id)).resolves.toMatchObject({
          status: JobStatus.PROCESSING,
          failCount: 0,
        });
      } finally {
        release.resolve();
        await owner.stop();
      }
    },
  );

  it.each([false, true])(
    "keeps a healthy job claimed when another scheduler initializes (draining: %s)",
    async (draining) => {
      const collectionName = uniqueCollectionName("leases");
      const worker = new Monque(db, {
        collectionName,
        leaseDuration: 30_000,
        heartbeatInterval: 20,
        lockTimeout: 10,
      });
      const observer = new Monque(db, { collectionName, lockTimeout: 10 });
      instances.push(worker, observer);
      await worker.initialize();
      const started: PromiseWithResolvers<void> = Promise.withResolvers();
      const release: PromiseWithResolvers<void> = Promise.withResolvers();
      worker.register("work", async () => {
        started.resolve();
        await release.promise;
      });
      const job = await worker.enqueue("work", {});
      worker.start();
      let stopping: Promise<void> | undefined;
      try {
        await started.promise;
        const claimed = await worker.getJob(job._id);
        if (draining) {
          stopping = worker.stop();
        }
        let previousDeadline = claimed?.leaseExpiresAt;
        const wasRenewed = async () => {
          const awaitedResult7 = await worker.getJob(job._id);
          const deadline = awaitedResult7?.leaseExpiresAt;
          if (!deadline || !previousDeadline || deadline <= previousDeadline) {
            return false;
          }
          previousDeadline = deadline;
          return true;
        };
        // Two renewals rule out a single heartbeat already in flight when draining starts.
        await forEachSequential(
          Array.from({ length: Math.ceil(2 / 1) }, (_, index) => index * 1),
          async (_renewal) => {
            await waitFor(wasRenewed);
          },
        );
        await observer.initialize();
        await expect(observer.getJob(job._id)).resolves.toMatchObject({
          status: JobStatus.PROCESSING,
          claimId: claimed?.claimId,
        });
      } finally {
        release.resolve();
        await worker.stop();
        await stopping;
      }
    },
  );
});
