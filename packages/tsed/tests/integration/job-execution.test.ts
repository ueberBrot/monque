import { JobStatus, NonRetryableError } from "@monque/core";
import type { Job } from "@monque/core";
import { PlatformTest } from "@tsed/platform-http/testing";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { JobController, Job as MonqueJob } from "@/decorators";
import { MonqueService } from "@/services";

import { waitFor } from "../test-utils.js";
import { bootstrapMonque, resetMonque } from "./helpers/bootstrap.js";

@JobController("execution")
class ExecutionController {
  static processed: string[] = [];
  static failCount = 0;

  @MonqueJob("permanent-failure")
  // oxlint-disable-next-line eslint/class-methods-use-this -- Decorated TsED handlers must remain prototype methods for discovery.
  permanentFailure() {
    throw new NonRetryableError("Account no longer exists");
  }

  @MonqueJob("success")
  // oxlint-disable-next-line eslint/class-methods-use-this -- Decorated TsED handlers must remain prototype methods for discovery.
  success(job: Job) {
    if (job._id) {
      ExecutionController.processed.push(job._id.toString());
    }
  }

  @MonqueJob("fail-once")
  // oxlint-disable-next-line eslint/class-methods-use-this -- Decorated TsED handlers must remain prototype methods for discovery.
  failOnce(job: Job) {
    if (ExecutionController.failCount === 0) {
      ExecutionController.failCount += 1;
      throw new Error("Intentional failure");
    }
    if (job._id) {
      ExecutionController.processed.push(job._id.toString());
    }
  }
}

describe("Job Execution Flow", () => {
  beforeEach(() => {
    ExecutionController.processed = [];
    ExecutionController.failCount = 0;
  });

  afterEach(resetMonque);

  it("should process a job successfully (Pending -> Processing -> Completed)", async () => {
    await bootstrapMonque({
      imports: [ExecutionController],
      connectionStrategy: "dbFactory",
    });

    const monqueService = PlatformTest.get<MonqueService>(MonqueService);
    const job = await monqueService.enqueue("execution.success", {});

    // Check Pending
    const pendingJob = await monqueService.getJob(job._id.toString());
    expect(pendingJob).not.toBeNull();
    expect(pendingJob?.status).toBe(JobStatus.PENDING);

    // Wait for completion via DB polling
    await waitFor(async () => {
      const persistedJob = await monqueService.getJob(job._id.toString());
      return persistedJob?.status === JobStatus.COMPLETED && persistedJob?.updatedAt !== undefined;
    });

    // Check Completed
    const completedJob = await monqueService.getJob(job._id.toString());
    expect(completedJob).not.toBeNull();
    expect(completedJob?.status).toBe(JobStatus.COMPLETED);
    expect(completedJob?.updatedAt).toBeDefined();
  });

  it("should retry failed jobs (Pending -> Processing -> Failed -> Retry -> Completed)", async () => {
    await bootstrapMonque({
      imports: [ExecutionController],
      connectionStrategy: "dbFactory",
    });
    const monqueService = PlatformTest.get<MonqueService>(MonqueService);

    const job = await monqueService.enqueue("execution.fail-once", {});

    // Wait for first failure (failCount incremented)
    await waitFor(() => ExecutionController.failCount === 1);

    // At this point, the job should have failed and been rescheduled (backoff).
    // We wait for it to be processed again and complete.
    await waitFor(
      async () => {
        const persistedJob = await monqueService.getJob(job._id.toString());
        return persistedJob?.status === JobStatus.COMPLETED;
      },
      {
        timeout: 10_000,
      },
    );

    const completedJob = await monqueService.getJob(job._id.toString());
    expect(completedJob).not.toBeNull();
    expect(completedJob?.status).toBe(JobStatus.COMPLETED);
    // failedCount might be 1 (failed once)
    expect(completedJob?.failCount).toBe(1);
  });

  it("preserves non-retryable errors thrown by decorated handlers", async () => {
    await bootstrapMonque({
      imports: [ExecutionController],
      connectionStrategy: "dbFactory",
      monqueConfig: { maxRetries: 10 },
    });
    const service = PlatformTest.get<MonqueService>(MonqueService);
    const job = await service.enqueue("execution.permanent-failure", {});
    await waitFor(async () => {
      const polledJob = await service.getJob(job._id.toHexString());
      return polledJob?.status === JobStatus.FAILED;
    });
    await expect(service.getJob(job._id.toHexString())).resolves.toMatchObject({
      status: JobStatus.FAILED,
      failCount: 1,
      failReason: "Account no longer exists",
    });
  });
});
