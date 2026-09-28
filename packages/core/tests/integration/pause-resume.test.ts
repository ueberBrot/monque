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
    monque.register("paused", async () => {});
    monque.register("other", async () => {});
    const paused = await monque.enqueue("paused", {});
    const other = await monque.enqueue("other", {});
    monque.start();
    await waitFor(async () => (await monque.getJob(other._id))?.status === JobStatus.COMPLETED);
    expect((await monque.getJob(paused._id))?.status).toBe(JobStatus.PENDING);
    monque.resume("paused");
    monque.resume("paused");
    await waitFor(async () => (await monque.getJob(paused._id))?.status === JobStatus.COMPLETED);
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
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    monque.register("active", async () => {
      started.resolve();
      await release.promise;
    });
    monque.register("next", async () => {});
    const active = await monque.enqueue("active", {});
    monque.start();
    try {
      await started.promise;
      monque.pause();
      const next = await monque.enqueue("next", {});
      const original = (await monque.getJob(active._id))?.leaseExpiresAt;
      await waitFor(async () => {
        const renewed = (await monque.getJob(active._id))?.leaseExpiresAt;
        return renewed instanceof Date && original instanceof Date && renewed > original;
      });
      expect(monque.isHealthy()).toBe(true);
      expect((await monque.getJob(next._id))?.status).toBe(JobStatus.PENDING);
      release.resolve();
      await waitFor(async () => (await monque.getJob(active._id))?.status === JobStatus.COMPLETED);
      expect((await monque.getJob(next._id))?.status).toBe(JobStatus.PENDING);
      monque.resume();
      await waitFor(async () => (await monque.getJob(next._id))?.status === JobStatus.COMPLETED);
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
    local.register("work", async () => {
      handled.push("local");
    });
    other.register("work", async () => {
      handled.push("other");
    });
    local.pause("work");
    local.pause();
    expect(local.getProcessingState("work")).toMatchObject({ paused: true, globallyPaused: true });
    local.resume();
    expect(local.getProcessingState("work")).toEqual({
      instanceId: local.getProcessingState().instanceId,
      name: "work",
      paused: true,
      globallyPaused: false,
    });
    expect(other.getProcessingState().instanceId).not.toBe(local.getProcessingState().instanceId);
    expect(local.isPaused()).toBe(false);
    expect(local.isPaused("work")).toBe(true);
    const job = await local.enqueue("work", {});
    local.start();
    other.start();
    await waitFor(async () => (await other.getJob(job._id))?.status === JobStatus.COMPLETED);
    expect(handled).toEqual(["other"]);
  });
});
