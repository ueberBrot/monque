import { setTimeout as delay } from "node:timers/promises";
/**
 * Integration tests for producer-only mode (disableJobProcessing).
 *
 * Tests that instances with disableJobProcessing: true can enqueue jobs
 * but don't process them.
 */
import { JobStatus } from "@monque/core";
import type { Job } from "@monque/core";
import { PlatformTest } from "@tsed/platform-http/testing";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { JobController, Job as MonqueJob } from "@/decorators";
import { MonqueService } from "@/services";

import { waitFor } from "../test-utils.js";
import { bootstrapMonque, getTestDb, resetMonque } from "./helpers/bootstrap.js";

// Job controller that tracks if it was ever called
@JobController("producer-test")
class ProducerTestController {
  static processed = false;
  static processedCount = 0;

  @MonqueJob("job")
  // oxlint-disable-next-line eslint/class-methods-use-this -- Decorated TsED handlers must remain prototype methods for discovery.
  handler(_job: Job) {
    ProducerTestController.processed = true;
    ProducerTestController.processedCount += 1;
  }
}

describe("Producer-only Mode (disableJobProcessing)", () => {
  afterEach(resetMonque);

  describe("disableJobProcessing: true", () => {
    beforeEach(async () => {
      ProducerTestController.processed = false;
      ProducerTestController.processedCount = 0;

      await bootstrapMonque({
        imports: [ProducerTestController],
        connectionStrategy: "db",
        monqueConfig: {
          disableJobProcessing: true,
        },
      });
    });

    it("enqueues a deduplicated batch through the injected service", async () => {
      const service = PlatformTest.get<MonqueService>(MonqueService);
      const runAt = new Date(Date.now() + 60_000);
      await expect(
        service.enqueueMany([
          { name: "producer-test.job", data: { first: true }, uniqueKey: "shared", runAt },
          { name: "producer-test.job", data: { first: true }, uniqueKey: "shared", runAt },
        ]),
      ).resolves.toStrictEqual({ insertedCount: 1, deduplicatedCount: 1 });
      const jobs = await service.getJobs({ name: "producer-test.job" });
      expect(jobs).toMatchObject([
        { data: { first: true }, nextRunAt: runAt, status: JobStatus.PENDING },
      ]);
    });

    it("keeps injected job writes in the caller-owned transaction", async () => {
      const service = PlatformTest.get<MonqueService>(MonqueService);
      const db = getTestDb();
      await db.client.withSession(async (session) => {
        session.startTransaction();
        await service.enqueue("producer-test.job", {}, { session });
        await service.enqueueMany([{ name: "producer-test.job", data: {} }], { session });
        await service.schedule("0 0 1 1 *", "producer-test.job", {}, { session });
        await expect(db.collection("monque_jobs").countDocuments({}, { session })).resolves.toBe(3);
        await expect(db.collection("monque_jobs").countDocuments()).resolves.toBe(0);
        await session.abortTransaction();
        expect(session.hasEnded).toBe(false);
      });
      await expect(service.getJobs()).resolves.toStrictEqual([]);
    });

    it("should not process jobs even with jobs defined", async () => {
      const service = PlatformTest.get<MonqueService>(MonqueService);

      await service.enqueue("producer-test.job", { test: true });

      // Wait a bit to ensure job would have been processed if running
      await delay(500);

      // Job should NOT have been processed
      expect(ProducerTestController.processed).toBe(false);
      expect(ProducerTestController.processedCount).toBe(0);
    });

    it("should leave jobs in pending status", async () => {
      const service = PlatformTest.get<MonqueService>(MonqueService);
      const db = getTestDb();

      await service.enqueue("producer-test.job", { test: true });

      // Wait a bit
      await delay(200);

      // Check job status in database
      const job = await db.collection("monque_jobs").findOne({ name: "producer-test.job" });

      expect(job).toBeDefined();
      expect(job?.["status"]).toBe(JobStatus.PENDING);
    });

    it("should report isHealthy as false", () => {
      const service = PlatformTest.get<MonqueService>(MonqueService);

      // isHealthy should be false since scheduler is not running
      expect(service.isHealthy()).toBe(false);
    });
  });

  describe("disableJobProcessing: false (default)", () => {
    beforeEach(async () => {
      ProducerTestController.processed = false;
      ProducerTestController.processedCount = 0;

      await bootstrapMonque({
        imports: [ProducerTestController],
        connectionStrategy: "db",
        // disableJobProcessing defaults to false
      });
    });

    it("should process jobs normally", async () => {
      const service = PlatformTest.get<MonqueService>(MonqueService);

      await service.enqueue("producer-test.job", { test: true });

      await waitFor(() => ProducerTestController.processed, { timeout: 5000 });

      expect(ProducerTestController.processed).toBe(true);
    });

    it("should report isHealthy as true", () => {
      const service = PlatformTest.get<MonqueService>(MonqueService);

      expect(service.isHealthy()).toBe(true);
    });
  });
});
