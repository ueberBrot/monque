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
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
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
      survivor.register("work", async () => {});
      await waitFor(async () => (await survivor.getJob(job._id))?.status === JobStatus.COMPLETED);
    } finally {
      release.resolve();
      await survivor.stop();
      await waitFor(
        async () => (await owner.getQueueViewSummaries())[0]?.worker?.activeCount === 0,
      );
    }
  });

  it.each([false, true])(
    "does not revive an expired lease or accept its late result (failure: %s)",
    async (fail) => {
      const collectionName = uniqueCollectionName("expired-lease");
      const owner = new Monque(db, {
        collectionName,
        leaseDuration: 500,
        heartbeatInterval: 20,
        shutdownTimeout: 1,
        recoverStaleJobs: false,
        pollInterval: 20,
        safetyPollInterval: 20,
      });
      instances.push(owner);
      await owner.initialize();
      const started = Promise.withResolvers<void>();
      const probeStarted = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      owner.register("work", async () => {
        started.resolve();
        await release.promise;
        if (fail) throw new Error("Expired handler failed");
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
        const previous = (await owner.getJob(probe._id))?.lastHeartbeat;
        await waitFor(async () => {
          const current = (await owner.getJob(probe._id))?.lastHeartbeat;
          return current instanceof Date && previous instanceof Date && current > previous;
        });
        expect((await owner.getJob(job._id))?.leaseExpiresAt).toEqual(deadline);
        release.resolve();
        await waitFor(async () =>
          (await owner.getQueueViewSummaries()).every((view) => view.worker?.activeCount === 0),
        );
        expect(await owner.getJob(job._id)).toMatchObject({
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
        leaseDuration: 1000,
        heartbeatInterval: 20,
        lockTimeout: 10,
      });
      const observer = new Monque(db, { collectionName, lockTimeout: 10 });
      instances.push(worker, observer);
      await worker.initialize();
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
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
        if (draining) stopping = worker.stop();
        await waitFor(async () => {
          const heartbeat = (await worker.getJob(job._id))?.lastHeartbeat;
          return (
            heartbeat instanceof Date &&
            claimed?.leaseExpiresAt instanceof Date &&
            heartbeat > claimed.leaseExpiresAt
          );
        });
        await observer.initialize();
        expect(await observer.getJob(job._id)).toMatchObject({
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
