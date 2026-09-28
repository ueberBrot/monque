import type { Db } from "mongodb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";

import { JobStatus, Monque, NonRetryableError } from "@/index";
import {
  cleanupTestDb,
  getTestDb,
  stopMonqueInstances,
  uniqueCollectionName,
  waitFor,
} from "@test-utils/test-utils";

describe("non-retryable handler errors", () => {
  let db: Db;
  const instances: Monque[] = [];

  beforeAll(async () => {
    db = await getTestDb("non-retryable-error");
  });
  afterEach(async () => {
    await stopMonqueInstances(instances);
  });
  afterAll(async () => {
    await cleanupTestDb(db);
  });

  it("fails immediately, reports no automatic retry, and permits manual retry", async () => {
    const monque = new Monque(db, {
      collectionName: uniqueCollectionName("permanent"),
      maxRetries: 10,
      baseRetryInterval: 10,
    });
    instances.push(monque);
    await monque.initialize();
    const error = new NonRetryableError("Account no longer exists");
    const failures: boolean[] = [];
    const errors: Error[] = [];
    monque.on("job:fail", (event) => {
      failures.push(event.willRetry);
      errors.push(event.error);
    });
    let repaired = false;
    monque.register("deliver", async () => {
      if (!repaired) throw error;
    });
    const job = await monque.enqueue("deliver", {}, { uniqueKey: "account" });
    monque.start();
    await waitFor(async () => failures.length > 0);
    expect(failures).toEqual([false]);
    expect(errors).toEqual([error]);
    const failed = await monque.getJob(job._id);
    expect(failed).toMatchObject({
      status: JobStatus.FAILED,
      failCount: 1,
      failReason: "Account no longer exists",
    });
    expect(failed?.claimedBy).toBeUndefined();
    expect(failed?.lockedAt).toBeUndefined();
    repaired = true;
    await monque.retryJob(job._id.toHexString());
    await waitFor(async () => (await monque.getJob(job._id))?.status === JobStatus.COMPLETED);
    expect(failures).toEqual([false]);
  });

  it("stops recurring jobs and releases their unique key", async () => {
    const monque = new Monque(db, { collectionName: uniqueCollectionName("recurring") });
    instances.push(monque);
    await monque.initialize();
    monque.register("daily", async () => {
      throw new NonRetryableError("Invalid subscription");
    });
    const job = await monque.schedule(
      "0 9 * * *",
      "daily",
      {},
      {
        timezone: "Europe/Berlin",
        uniqueKey: "subscription",
      },
    );
    await monque.rescheduleJob(job._id.toHexString(), new Date());
    monque.start();
    await waitFor(async () => (await monque.getJob(job._id))?.status === JobStatus.FAILED);
    await monque.stop();
    expect(await monque.getJob(job._id)).toMatchObject({
      status: JobStatus.FAILED,
      failCount: 1,
      repeatInterval: "0 9 * * *",
      timezone: "Europe/Berlin",
    });
    const replacement = await monque.schedule(
      "0 9 * * *",
      "daily",
      {},
      {
        uniqueKey: "subscription",
        timezone: "Europe/Berlin",
      },
    );
    expect(replacement._id.equals(job._id)).toBe(false);
    const duplicate = await monque.schedule(
      "0 9 * * *",
      "daily",
      {},
      {
        uniqueKey: "subscription",
        timezone: "Europe/Berlin",
      },
    );
    expect(duplicate._id.equals(replacement._id)).toBe(true);
  });

  it("keeps retrying ordinary errors even when their name matches the special error", async () => {
    const monque = new Monque(db, {
      collectionName: uniqueCollectionName("transient"),
      maxRetries: 3,
      baseRetryInterval: 10,
    });
    instances.push(monque);
    await monque.initialize();
    const failures: boolean[] = [];
    monque.on("job:fail", ({ willRetry }) => failures.push(willRetry));
    monque.register("transient", async (job) => {
      if (job.failCount === 0) {
        const error = new Error("Temporary outage");
        error.name = "NonRetryableError";
        throw error;
      }
    });
    const job = await monque.enqueue("transient", {});
    monque.start();
    await waitFor(async () => (await monque.getJob(job._id))?.status === JobStatus.COMPLETED);
    expect(failures).toEqual([true]);
    expect((await monque.getJob(job._id))?.failCount).toBe(1);
  });

  it("does not overwrite a recovered job when its former owner fails later", async () => {
    const collectionName = uniqueCollectionName("ownership");
    const first = new Monque(db, { collectionName, lockTimeout: 50, workerConcurrency: 1 });
    instances.push(first);
    await first.initialize();
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const failures: boolean[] = [];
    first.on("job:fail", ({ willRetry }) => failures.push(willRetry));
    first.register("owned", async () => {
      started.resolve();
      await release.promise;
      throw new NonRetryableError("Late failure");
    });
    const job = await first.enqueue("owned", {});
    first.start();
    try {
      await started.promise;
      await waitFor(async () => {
        const lockedAt = (await first.getJob(job._id))?.lockedAt;
        return lockedAt != null && Date.now() - lockedAt.getTime() > 50;
      });
      const second = new Monque(db, { collectionName, lockTimeout: 50, workerConcurrency: 1 });
      instances.push(second);
      await second.initialize();
      second.register("owned", async () => {});
      second.start();
      await waitFor(async () => (await second.getJob(job._id))?.status === JobStatus.COMPLETED);
    } finally {
      release.resolve();
      await first.stop();
    }
    expect(await first.getJob(job._id)).toMatchObject({
      status: JobStatus.COMPLETED,
      failCount: 0,
    });
    expect(failures).toEqual([]);
  });
});
