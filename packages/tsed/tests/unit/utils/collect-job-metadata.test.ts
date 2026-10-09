/* oxlint-disable eslint/max-classes-per-file -- Each scenario needs fresh decorated constructors to isolate global TsED metadata. */
import { Store } from "@tsed/core";
import { describe, expect, it } from "vite-plus/test";

import { MONQUE } from "@/constants";
import { Cron } from "@/decorators/cron";
import { JobController } from "@/decorators/job-controller";
import type { JobStore } from "@/decorators/types";
import { collectJobMetadata } from "@/utils/collect-job-metadata";

describe(collectJobMetadata, () => {
  it("should return empty array if no job store exists", () => {
    // oxlint-disable-next-line typescript/no-extraneous-class -- TsED metadata and DI tokens require a distinct constructor.
    class PlainClass {}
    const metadata = collectJobMetadata(PlainClass);
    expect(metadata).toStrictEqual([]);
  });

  it("should collect jobs and cron jobs", () => {
    @JobController("test")
    class TestController {
      @Cron("* * * * *")
      // oxlint-disable-next-line eslint/class-methods-use-this -- Decorated TsED handlers must remain prototype methods for discovery.
      cronJob() {}
    }

    // Manually add a job to the store to simulate mixed usage
    // (Normally @Job would do this, but we want to be explicit)
    const store = Store.from(TestController);
    const existing = store.get<Partial<JobStore> | undefined>(MONQUE) ?? {};
    store.set(MONQUE, {
      ...existing,
      jobs: [
        {
          name: "worker-job",
          method: "workerMethod",
          opts: { concurrency: 2 },
        },
      ],
    });

    const metadata = collectJobMetadata(TestController);

    expect(metadata).toHaveLength(2);
    expect(metadata).toStrictEqual(
      expect.arrayContaining([
        {
          fullName: "test.cronJob",
          method: "cronJob",
          opts: {},
          isCron: true,
          cronPattern: "* * * * *",
        },
        {
          fullName: "test.worker-job",
          method: "workerMethod",
          opts: { concurrency: 2 },
          isCron: false,
        },
      ]),
    );
  });
});
