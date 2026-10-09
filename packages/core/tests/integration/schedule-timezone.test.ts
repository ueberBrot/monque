import type { Db } from "mongodb";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { Monque } from "@/scheduler";
import { InvalidCronError } from "@/shared";
import {
  cleanupTestDb,
  getTestDb,
  stopMonqueInstances,
  uniqueCollectionName,
} from "@test-utils/test-utils";

describe("recurring schedule timezones", () => {
  let db: Db;
  const instances: Monque[] = [];
  beforeAll(async () => {
    db = await getTestDb("schedule-timezone");
  });
  afterEach(async () => {
    await stopMonqueInstances(instances);
    vi.useRealTimers();
  });

  afterAll(async () => {
    await cleanupTestDb(db);
  });

  it.each([
    ["winter", "0 9 * * *", "Europe/Berlin", "2026-01-15T00:00:00Z", "2026-01-15T08:00:00Z"],
    ["summer", "0 9 * * *", "Europe/Berlin", "2026-07-15T00:00:00Z", "2026-07-15T07:00:00Z"],
    [
      "quarter-hour offset",
      "0 9 * * *",
      "Asia/Kathmandu",
      "2026-01-15T00:00:00Z",
      "2026-01-15T03:15:00Z",
    ],
    ["UTC", "0 9 * * *", "UTC", "2026-01-15T00:00:00Z", "2026-01-15T09:00:00Z"],
    [
      "spring missing hour",
      "30 2 * * *",
      "Europe/Berlin",
      "2026-03-29T00:00:00Z",
      "2026-03-29T01:30:00Z",
    ],
    [
      "autumn repeated hour",
      "30 2 * * *",
      "Europe/Berlin",
      "2026-10-25T00:00:00Z",
      "2026-10-25T00:30:00Z",
    ],
  ])(
    "persists the timezone and next occurrence for %s",
    async (_case, cron, timezone, now, expected) => {
      const monque = new Monque(db, { collectionName: uniqueCollectionName("timezone") });
      instances.push(monque);
      await monque.initialize();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(now));
      const job = await monque.schedule(cron, "daily-report", {}, { timezone });
      await expect(monque.getJob(job._id)).resolves.toMatchObject({
        timezone,
        nextRunAt: new Date(expected),
      });
    },
  );

  it.each([
    [
      "spring DST",
      "0 9 * * *",
      "2026-03-28T00:00:00Z",
      "2026-03-28T08:00:00Z",
      "2026-03-29T07:00:00Z",
    ],
    [
      "autumn DST",
      "0 9 * * *",
      "2026-10-24T00:00:00Z",
      "2026-10-24T07:00:00Z",
      "2026-10-25T08:00:00Z",
    ],
    [
      "autumn repeated hour",
      "30 2 * * *",
      "2026-10-25T00:00:00Z",
      "2026-10-25T00:30:00Z",
      "2026-10-26T01:30:00Z",
    ],
  ])(
    "uses the saved timezone after another instance completes a run across %s",
    async (_case, cron, now, runAt, expected) => {
      const collectionName = uniqueCollectionName("timezone");
      const producer = new Monque(db, { collectionName });
      const worker = new Monque(db, { collectionName, pollInterval: 20 });
      instances.push(producer, worker);
      await producer.initialize();
      await worker.initialize();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(now));
      const job = await producer.schedule(
        cron,
        "daily-report",
        {},
        {
          timezone: "Europe/Berlin",
        },
      );
      const handled = vi.fn<() => void>();
      worker.register("daily-report", handled);
      const completedResult: PromiseWithResolvers<void> = Promise.withResolvers();
      worker.once("job:complete", () => {
        completedResult.resolve();
      });
      const completed = completedResult.promise;
      vi.setSystemTime(new Date(runAt));
      worker.start();
      await completed;
      expect(handled).toHaveBeenCalledOnce();
      await expect(producer.getJob(job._id)).resolves.toMatchObject({
        timezone: "Europe/Berlin",
        nextRunAt: new Date(expected),
        status: "pending",
      });
    },
  );

  it.each(["", "Not/AZone", "local", "+01:00", "-05:00"])(
    "rejects invalid timezone %j before creating a job",
    async (timezone) => {
      const monque = new Monque(db, { collectionName: uniqueCollectionName("timezone") });
      instances.push(monque);
      await monque.initialize();
      await expect(monque.schedule("0 9 * * *", "daily-report", {}, { timezone })).rejects.toThrow(
        new InvalidCronError(
          "0 9 * * *",
          `Invalid timezone "${timezone}". Expected an IANA timezone such as "Europe/Berlin" or "UTC".`,
        ),
      );
      await expect(monque.getJobs()).resolves.toStrictEqual([]);
    },
  );

  it("preserves server-local scheduling for stored jobs without a timezone", async () => {
    const monque = new Monque(db, {
      collectionName: uniqueCollectionName("timezone"),
      pollInterval: 20,
    });
    instances.push(monque);
    await monque.initialize();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 0, 15));
    const job = await monque.schedule("0 9 * * *", "daily-report", {});
    expect(job.nextRunAt).toStrictEqual(new Date(2026, 0, 15, 9));
    await expect(monque.getJob(job._id)).resolves.not.toHaveProperty("timezone");
    monque.register("daily-report", () => {});
    const completedResult: PromiseWithResolvers<void> = Promise.withResolvers();
    monque.once("job:complete", () => {
      completedResult.resolve();
    });
    const completed = completedResult.promise;
    vi.setSystemTime(new Date(2026, 0, 15, 9));
    monque.start();
    await completed;
    const next = await monque.getJob(job._id);
    expect(next?.nextRunAt).toStrictEqual(new Date(2026, 0, 16, 9));
    expect(next).not.toHaveProperty("timezone");
  });

  it("keeps the original schedule and timezone when the unique key is reused", async () => {
    const monque = new Monque(db, { collectionName: uniqueCollectionName("timezone") });
    instances.push(monque);
    await monque.initialize();
    const original = await monque.schedule(
      "0 9 * * *",
      "daily-report",
      {},
      {
        timezone: "Europe/Berlin",
        uniqueKey: "daily-report",
      },
    );
    const duplicate = await monque.schedule(
      "0 10 * * *",
      "daily-report",
      {},
      {
        timezone: "America/New_York",
        uniqueKey: "daily-report",
      },
    );
    expect(duplicate).toStrictEqual(original);
    await expect(monque.getJob(original._id)).resolves.toStrictEqual(original);
  });

  it("preserves the timezone through a failed attempt and resumes cron timing after retry", async () => {
    const monque = new Monque(db, {
      collectionName: uniqueCollectionName("timezone"),
      pollInterval: 20,
    });
    instances.push(monque);
    await monque.initialize();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-28T00:00:00Z"));
    const job = await monque.schedule(
      "0 9 * * *",
      "daily-report",
      {},
      { timezone: "Europe/Berlin" },
    );
    let attempts = 0;
    monque.register("daily-report", () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("Temporary failure");
      }
    });
    const failedResult: PromiseWithResolvers<void> = Promise.withResolvers();
    monque.once("job:fail", () => {
      failedResult.resolve();
    });
    const failed = failedResult.promise;
    const completedResult: PromiseWithResolvers<void> = Promise.withResolvers();
    monque.once("job:complete", () => {
      completedResult.resolve();
    });
    const completed = completedResult.promise;
    vi.setSystemTime(new Date("2026-03-28T08:00:00Z"));
    monque.start();
    await failed;
    const retry = await monque.getJob(job._id);
    expect(retry).toMatchObject({ timezone: "Europe/Berlin", failCount: 1, status: "pending" });
    if (!retry) {
      throw new Error("Expected the recurring job to remain available for retry");
    }
    vi.setSystemTime(retry.nextRunAt);
    await completed;
    expect(attempts).toBe(2);
    await expect(monque.getJob(job._id)).resolves.toMatchObject({
      timezone: "Europe/Berlin",
      failCount: 0,
      status: "pending",
      nextRunAt: new Date("2026-03-29T07:00:00Z"),
    });
  });
});
