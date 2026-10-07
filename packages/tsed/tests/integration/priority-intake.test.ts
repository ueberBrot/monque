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
    expect(await service.getJob(immediate._id)).toMatchObject({ priority: 14 });
    const single = await service.enqueue("single", {}, { priority: -3 });
    expect(await service.getJob(single._id)).toMatchObject({ priority: -3 });
    expect(
      await service.enqueueMany([
        { name: "batch", data: "high", priority: 5 },
        { name: "batch", data: "low", priority: -8 },
        { name: "batch", data: "default" },
      ]),
    ).toEqual({ insertedCount: 3, deduplicatedCount: 0 });
    expect((await service.getJobs({ name: "batch" })).map((job) => job.priority)).toEqual([
      5, -8, 0,
    ]);
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
      expect(await service.getJobs()).toEqual([]);
      await session.commitTransaction();
      session.startTransaction();
      await service.now("aborted", {}, { session, priority: -4 });
      await session.abortTransaction();
      expect(session.hasEnded).toBe(false);
    });
    expect(await service.getJobs()).toMatchObject([{ name: "committed", priority: 11 }]);
  });
});
