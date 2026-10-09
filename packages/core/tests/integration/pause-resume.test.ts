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

describe("local pause and resume", () => {
  let db: Db;
  const instances: Monque[] = [];
  beforeAll(async () => {
    db = await getTestDb("pause-resume");
  });
  afterEach(async () => {
    await stopMonqueInstances(instances);
  });

  afterAll(async () => {
    await cleanupTestDb(db);
  });

  it("keeps an individually paused worker pending while other workers run, then resumes it", async () => {
    const monque = new Monque(db, {
      collectionName: uniqueCollectionName("worker-pause"),
      pollInterval: 60_000,
      safetyPollInterval: 60_000,
    });
    instances.push(monque);
    monque.pause("paused");
    monque.pause("paused");
    await monque.initialize();
    monque.register("paused", () => {});
    monque.register("other", () => {});
    const paused = await monque.enqueue("paused", {});
    const other = await monque.enqueue("other", {});
    monque.start();
    await waitFor(async () => {
      const awaitedResult1 = await monque.getJob(other._id);
      return awaitedResult1?.status === JobStatus.COMPLETED;
    });
    const awaitedResult2 = await monque.getJob(paused._id);
    expect(awaitedResult2?.status).toBe(JobStatus.PENDING);
    monque.resume("paused");
    monque.resume("paused");
    await waitFor(async () => {
      const awaitedResult3 = await monque.getJob(paused._id);
      return awaitedResult3?.status === JobStatus.COMPLETED;
    });
    expect(monque.isPaused("paused")).toBe(false);
  });

  it("renews and finishes active work during a global pause while new work waits", async () => {
    const monque = new Monque(db, {
      collectionName: uniqueCollectionName("global-pause"),
      leaseDuration: 1000,
      heartbeatInterval: 20,
      pollInterval: 20,
      safetyPollInterval: 20,
    });
    instances.push(monque);
    await monque.initialize();
    const started: PromiseWithResolvers<void> = Promise.withResolvers();
    const release: PromiseWithResolvers<void> = Promise.withResolvers();
    monque.register("active", async () => {
      started.resolve();
      await release.promise;
    });
    monque.register("next", () => {});
    const active = await monque.enqueue("active", {});
    monque.start();
    try {
      await started.promise;
      monque.pause();
      const next = await monque.enqueue("next", {});
      const awaitedResult4 = await monque.getJob(active._id);
      const original = awaitedResult4?.leaseExpiresAt;
      await waitFor(async () => {
        const awaitedResult5 = await monque.getJob(active._id);
        const renewed = awaitedResult5?.leaseExpiresAt;
        return renewed instanceof Date && original instanceof Date && renewed > original;
      });
      expect(monque.isHealthy()).toBe(true);
      const awaitedResult6 = await monque.getJob(next._id);
      expect(awaitedResult6?.status).toBe(JobStatus.PENDING);
      release.resolve();
      await waitFor(async () => {
        const awaitedResult7 = await monque.getJob(active._id);
        return awaitedResult7?.status === JobStatus.COMPLETED;
      });
      const awaitedResult8 = await monque.getJob(next._id);
      expect(awaitedResult8?.status).toBe(JobStatus.PENDING);
      monque.resume();
      await waitFor(async () => {
        const awaitedResult9 = await monque.getJob(next._id);
        return awaitedResult9?.status === JobStatus.COMPLETED;
      });
    } finally {
      release.resolve();
    }
  });

  it("keeps worker pauses after global resume and allows another scheduler to consume", async () => {
    const options = {
      collectionName: uniqueCollectionName("local-only"),
      pollInterval: 20,
      safetyPollInterval: 20,
    };
    const local = new Monque(db, options);
    const other = new Monque(db, options);
    instances.push(local, other);
    await local.initialize();
    await other.initialize();
    const handled: string[] = [];
    local.register("work", () => {
      handled.push("local");
    });
    other.register("work", () => {
      handled.push("other");
    });
    local.pause("work");
    local.pause();
    expect(local.getProcessingState("work")).toMatchObject({ paused: true, globallyPaused: true });
    local.resume();
    expect(local.getProcessingState("work")).toStrictEqual({
      instanceId: local.getProcessingState().instanceId,
      name: "work",
      paused: true,
      globallyPaused: false,
    });
    expect(other.getProcessingState().instanceId).not.toBe(local.getProcessingState().instanceId);
    expect({
      localIsPaused: local.isPaused(),
      localIsPausedWork: local.isPaused("work"),
    }).toStrictEqual({
      localIsPaused: false,
      localIsPausedWork: true,
    });
    const job = await local.enqueue("work", {});
    local.start();
    other.start();
    await waitFor(async () => {
      const awaitedResult10 = await other.getJob(job._id);
      return awaitedResult10?.status === JobStatus.COMPLETED;
    });
    expect(handled).toStrictEqual(["other"]);
  });
});
