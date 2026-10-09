/* oxlint-disable eslint/max-classes-per-file -- Each scenario needs fresh decorated constructors to isolate global TsED metadata. */
import { setImmediate } from "node:timers/promises";
import { JobStatus } from "@monque/core";
import type { Job } from "@monque/core";
import { PlatformTest } from "@tsed/platform-http/testing";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { JobController, Job as MonqueJob } from "@/decorators";
import { MonqueService } from "@/services";

import { waitFor } from "../test-utils.js";
import { bootstrapMonque, resetMonque } from "./helpers/bootstrap.js";

@JobController("email")
class EmailJobs {
  public processed: string[] = [];

  @MonqueJob("send")
  sendEmail(job: Job<{ to: string }>) {
    this.processed.push(job.data.to);
    return { sent: true };
  }

  @MonqueJob("welcome", { concurrency: 5 })
  sendWelcome(job: Job<{ userId: string }>) {
    this.processed.push(`welcome:${job.data.userId}`);
    return "welcome";
  }
}

@JobController()
class SystemJobs {
  public executed = false;

  @MonqueJob("cleanup")
  cleanup() {
    this.executed = true;
  }
}

describe("Job Registration Integration", () => {
  afterEach(resetMonque);

  describe("Job Processing", () => {
    beforeEach(async () => {
      await bootstrapMonque({
        imports: [EmailJobs, SystemJobs],
        connectionStrategy: "dbFactory",
      });
    });

    it("routes each namespaced job to its decorated handler", async () => {
      const monqueService = PlatformTest.get<MonqueService>(MonqueService);
      const emailJobs = PlatformTest.get<EmailJobs>(EmailJobs);

      await monqueService.now("email.send", { to: "test@example.com" });
      await monqueService.now("email.welcome", { userId: "user-1" });

      await waitFor(() => emailJobs.processed.length === 2);

      expect(emailJobs.processed).toStrictEqual(
        expect.arrayContaining(["test@example.com", "welcome:user-1"]),
      );
    });

    it("should invoke handler for non-namespaced job", async () => {
      const monqueService = PlatformTest.get<MonqueService>(MonqueService);
      const systemJobs = PlatformTest.get<SystemJobs>(SystemJobs);

      await monqueService.now("cleanup", {});

      await waitFor(() => systemJobs.executed);

      expect(systemJobs.executed).toBe(true);
    });
  });

  describe("Resilience", () => {
    it("should handle max retries", async () => {
      @JobController("resilience")
      class ResilienceJob {
        static failCount = 0;
        @MonqueJob("fail")
        // oxlint-disable-next-line eslint/class-methods-use-this -- Decorated TsED handlers must remain prototype methods for discovery.
        fail() {
          ResilienceJob.failCount += 1;
          throw new Error("Persistent failure");
        }
      }

      await bootstrapMonque({
        imports: [ResilienceJob],
        connectionStrategy: "dbFactory",
        monqueConfig: {
          maxRetries: 2,
          baseRetryInterval: 10,
          pollInterval: 100,
        },
      });

      const monqueService = PlatformTest.get<MonqueService>(MonqueService);
      const job = await monqueService.now("resilience.fail", {});

      await waitFor(
        async () => {
          const persistedJob = await monqueService.getJob(job._id.toString());
          return persistedJob?.status === JobStatus.FAILED;
        },
        { timeout: 10_000 },
      );

      const failedJob = await monqueService.getJob(job._id.toString());
      expect(failedJob?.status).toBe(JobStatus.FAILED);
      expect(failedJob?.failCount).toBe(2);
      expect(ResilienceJob.failCount).toBe(2);
    });
  });

  describe("Lifecycle Integration", () => {
    it("should wait for active jobs during stop()", async () => {
      const release: PromiseWithResolvers<void> = Promise.withResolvers();
      try {
        @JobController("lifecycle")
        class LifecycleJob {
          static started = false;
          static completed = false;
          @MonqueJob("long-running")
          // oxlint-disable-next-line eslint/class-methods-use-this -- Decorated TsED handlers must remain prototype methods for discovery.
          async longRunning() {
            LifecycleJob.started = true;
            await release.promise;
            LifecycleJob.completed = true;
          }
        }

        await bootstrapMonque({
          imports: [LifecycleJob],
          connectionStrategy: "dbFactory",
          monqueConfig: {
            pollInterval: 100,
          },
        });

        const monqueService = PlatformTest.get<MonqueService>(MonqueService);
        await monqueService.now("lifecycle.long-running", {});

        // Wait for it to start
        await waitFor(() => LifecycleJob.started);

        // Stop while it's running
        const streamClosed: PromiseWithResolvers<void> = Promise.withResolvers();
        monqueService.monque.once("changestream:closed", streamClosed.resolve);
        let stopped = false;
        const stopping = monqueService.monque.stop().then(() => {
          stopped = true;
        });
        await streamClosed.promise;
        await setImmediate();
        expect(stopped).toBe(false);
        release.resolve();
        await stopping;

        expect(LifecycleJob.completed).toBe(true);
      } finally {
        release.resolve();
      }
    });
  });
});
