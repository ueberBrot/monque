/* oxlint-disable eslint/max-classes-per-file -- Each scenario needs fresh decorated constructors to isolate global TsED metadata. */
import { JobStatus, MonqueError } from "@monque/core";
import type { Job } from "@monque/core";
import { PlatformTest } from "@tsed/platform-http/testing";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { JobController, Job as MonqueJob } from "@/decorators";
import { MonqueService } from "@/services";

import { waitFor } from "../test-utils.js";
import { bootstrapMonque, resetMonque } from "./helpers/bootstrap.js";

describe("runtime options", () => {
  afterEach(resetMonque);

  it("pauses and resumes a decorated worker through MonqueService", async () => {
    @JobController("pause")
    class EphemeralPausedController {
      @MonqueJob("work")
      // oxlint-disable-next-line eslint/class-methods-use-this -- Decorated TsED handlers must remain prototype methods for discovery.
      work() {}
      @MonqueJob("other")
      // oxlint-disable-next-line eslint/class-methods-use-this -- Decorated TsED handlers must remain prototype methods for discovery.
      other() {}
    }
    await bootstrapMonque({ imports: [EphemeralPausedController], connectionStrategy: "db" });
    const service = PlatformTest.get<MonqueService>(MonqueService);
    service.pause("pause.work");
    const pausedState = service.getProcessingState("pause.work");
    const queueViews = await service.getQueueViewSummaries({ name: "pause.work" });
    expect({ state: pausedState, queueViews }).toMatchObject({
      state: { name: "pause.work", paused: true, globallyPaused: false },
      queueViews: [{ name: "pause.work", worker: { paused: true, hasSchema: false } }],
    });
    const paused = await service.enqueue("pause.work", {});
    const other = await service.enqueue("pause.other", {});
    await waitFor(async () => {
      const polledJob = await service.getJob(other._id.toString());
      return polledJob?.status === JobStatus.COMPLETED;
    });
    const persistedJob = await service.getJob(paused._id.toString());
    expect(persistedJob?.status).toBe(JobStatus.PENDING);
    service.resume("pause.work");
    expect(service.getProcessingState("pause.work").paused).toBe(false);
    await expect(service.getQueueViewSummaries({ name: "pause.work" })).resolves.toMatchObject([
      { name: "pause.work", worker: { paused: false } },
    ]);
    await waitFor(async () => {
      const polledJob = await service.getJob(paused._id.toString());
      return polledJob?.status === JobStatus.COMPLETED;
    });
    expect(service.isPaused("pause.work")).toBe(false);
  });

  it("validates and transforms payloads supplied to a decorated handler", async () => {
    const received: number[] = [];
    const schema = z.object({ count: z.string().transform((value) => Number(value) + 1) });
    @JobController("schema")
    class EphemeralSchemaController {
      @MonqueJob("work", { schema })
      // oxlint-disable-next-line eslint/class-methods-use-this -- Decorated TsED handlers must remain prototype methods for discovery.
      handler(job: Job<z.output<typeof schema>>) {
        received.push(job.data.count);
      }
    }
    await bootstrapMonque({ imports: [EphemeralSchemaController], connectionStrategy: "db" });
    const service = PlatformTest.get<MonqueService>(MonqueService);
    const valid = await service.enqueue("schema.work", { count: "2" });
    const invalid = await service.enqueue("schema.work", { count: false });
    await waitFor(async () => {
      const firstPolledJob = await service.getJob(valid._id.toString());
      if (firstPolledJob?.status !== JobStatus.COMPLETED) {
        return false;
      }
      const secondPolledJob = await service.getJob(invalid._id.toString());
      return secondPolledJob?.status === JobStatus.FAILED;
    });
    expect(received).toStrictEqual([3]);
    const persistedJob = await service.getJob(invalid._id.toString());
    expect(persistedJob?.failCount).toBe(1);
    const validPersistedJob = await service.getJob(valid._id.toString());
    expect(validPersistedJob?.data).toStrictEqual({ count: "2" });
  });

  it("uses retry overrides supplied through a Job decorator", async () => {
    @JobController("retry")
    class EphemeralRetryController {
      @MonqueJob("custom", { maxRetries: 2, baseRetryInterval: 0 })
      // oxlint-disable-next-line eslint/class-methods-use-this -- Decorated TsED handlers must remain prototype methods for discovery.
      custom() {
        throw new Error("Unavailable");
      }

      @MonqueJob("default")
      // oxlint-disable-next-line eslint/class-methods-use-this -- Decorated TsED handlers must remain prototype methods for discovery.
      inherited() {
        throw new Error("Unavailable");
      }
    }
    await bootstrapMonque({
      imports: [EphemeralRetryController],
      connectionStrategy: "db",
      monqueConfig: { maxRetries: 1 },
    });
    const service = PlatformTest.get<MonqueService>(MonqueService);
    const custom = await service.enqueue("retry.custom", {});
    const inherited = await service.enqueue("retry.default", {});
    await waitFor(async () => {
      const firstPolledJob = await service.getJob(custom._id.toString());
      if (firstPolledJob?.status !== JobStatus.FAILED) {
        return false;
      }
      const secondPolledJob = await service.getJob(inherited._id.toString());
      return secondPolledJob?.status === JobStatus.FAILED;
    });
    const persistedJob = await service.getJob(custom._id.toString());
    expect(persistedJob?.failCount).toBe(2);
    const inheritedPersistedJob = await service.getJob(inherited._id.toString());
    expect(inheritedPersistedJob?.failCount).toBe(1);
  });

  it("renews claims configured through Ts.ED", async () => {
    const started: PromiseWithResolvers<void> = Promise.withResolvers();
    const release: PromiseWithResolvers<void> = Promise.withResolvers();
    @JobController("lease")
    class EphemeralLeaseController {
      @MonqueJob("work")
      // oxlint-disable-next-line eslint/class-methods-use-this -- Decorated TsED handlers must remain prototype methods for discovery.
      async handler() {
        started.resolve();
        await release.promise;
      }
    }
    try {
      await bootstrapMonque({
        imports: [EphemeralLeaseController],
        connectionStrategy: "db",
        monqueConfig: { leaseDuration: 1000, heartbeatInterval: 20 },
      });
      const service = PlatformTest.get<MonqueService>(MonqueService);
      const job = await service.enqueue("lease.work", {});
      await started.promise;
      const persistedJob = await service.getJob(job._id.toString());
      const deadline = persistedJob?.leaseExpiresAt;
      await waitFor(async () => {
        const polledJob = await service.getJob(job._id.toString());
        const current = polledJob?.leaseExpiresAt;
        return current instanceof Date && deadline instanceof Date && current > deadline;
      });
      const renewed = await service.getJob(job._id.toString());
      expect(renewed?.leaseExpiresAt?.getTime()).toBeGreaterThan(deadline?.getTime() ?? 0);
    } finally {
      release.resolve();
    }
  });

  it("rejects invalid scheduler configuration during bootstrap", async () => {
    await expect(
      bootstrapMonque({
        connectionStrategy: "db",
        monqueConfig: { workerConcurrency: Number.NaN },
      }),
    ).rejects.toThrow(MonqueError);
  });

  it("rejects invalid concurrency supplied through a Job decorator", async () => {
    @JobController("invalid-options")
    class EphemeralInvalidOptionsController {
      @MonqueJob("job", { concurrency: -1 })
      // oxlint-disable-next-line eslint/class-methods-use-this -- Decorated TsED handlers must remain prototype methods for discovery.
      handler(_job: Job) {}
    }

    await expect(
      bootstrapMonque({ imports: [EphemeralInvalidOptionsController], connectionStrategy: "db" }),
    ).rejects.toThrow("concurrency");
  });
});
