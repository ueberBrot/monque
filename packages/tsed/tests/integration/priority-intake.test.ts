import { PlatformTest } from "@tsed/platform-http/testing";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { MonqueService } from "@/services";

import { bootstrapMonque, getTestDb, resetMonque } from "./helpers/bootstrap.js";

describe("prioritized intake through Ts.ED", () => {
  afterEach(resetMonque);

  it("forwards single, immediate and per-Job batch priorities", async () => {
    await bootstrapMonque({
      connectionStrategy: "dbFactory",
      monqueConfig: { disableJobProcessing: true },
    });
    const service = PlatformTest.get<MonqueService>(MonqueService);
    const immediate = await service.now("immediate", {}, { priority: 14 });
    await expect(service.getJob(immediate._id)).resolves.toMatchObject({ priority: 14 });
    const single = await service.enqueue("single", {}, { priority: -3 });
    await expect(service.getJob(single._id)).resolves.toMatchObject({ priority: -3 });
    await expect(
      service.enqueueMany([
        { name: "batch", data: "high", priority: 5 },
        { name: "batch", data: "low", priority: -8 },
        { name: "batch", data: "default" },
      ]),
    ).resolves.toStrictEqual({ insertedCount: 3, deduplicatedCount: 0 });
    const persistedJob = await service.getJobs({ name: "batch" });
    expect(persistedJob.map((job) => job.priority)).toStrictEqual([5, -8, 0]);
  });

  it("forwards caller-owned sessions for immediate prioritized Jobs", async () => {
    await bootstrapMonque({
      connectionStrategy: "dbFactory",
      monqueConfig: { disableJobProcessing: true },
    });
    const service = PlatformTest.get<MonqueService>(MonqueService);
    await getTestDb().client.withSession(async (session) => {
      session.startTransaction();
      await service.now("committed", {}, { session, priority: 11 });
      await expect(service.getJobs()).resolves.toStrictEqual([]);
      await session.commitTransaction();
      session.startTransaction();
      await service.now("aborted", {}, { session, priority: -4 });
      await session.abortTransaction();
      expect(session.hasEnded).toBe(false);
    });
    await expect(service.getJobs()).resolves.toMatchObject([{ name: "committed", priority: 11 }]);
  });

  it("changes a pending Job priority through the public service", async () => {
    await bootstrapMonque({ connectionStrategy: "dbFactory" });
    const service = PlatformTest.get<MonqueService>(MonqueService);
    const job = await service.enqueue(
      "pending-priority",
      { preserved: true },
      { runAt: new Date(Date.now() + 60_000) },
    );
    const updated = await service.setJobPriority(job._id.toHexString(), -8);
    expect(updated).toMatchObject({
      priority: -8,
      data: { preserved: true },
      nextRunAt: job.nextRunAt,
    });
    const persistedJob = await service.getJob(job._id);
    expect(persistedJob?.priority).toBe(-8);
    await service.cancelJob(job._id.toHexString());
    await expect(service.setJobPriority(job._id.toHexString(), 8)).rejects.toThrow(
      "Cannot change priority",
    );
  });
});
