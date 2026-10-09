/* oxlint-disable eslint/max-classes-per-file -- Each scenario needs fresh decorated constructors to isolate global TsED metadata. */
import { Store } from "@tsed/core";
import { describe, expect, it } from "vite-plus/test";

import { MONQUE } from "@/constants";
import { Cron } from "@/decorators/cron";
import { JobController } from "@/decorators/job-controller";
import type { JobStore } from "@/decorators/types";

describe("@Cron", () => {
  it("should register a cron job in the store", () => {
    @JobController("test")
    class TestController {
      @Cron("* * * * *")
      // oxlint-disable-next-line eslint/class-methods-use-this -- Decorated TsED handlers must remain prototype methods for discovery.
      testMethod() {}
    }

    const store = Store.from(TestController).get<JobStore>(MONQUE);

    expect(store).toBeDefined();
    expect(store.cronJobs).toHaveLength(1);
    expect(store.cronJobs[0]).toStrictEqual({
      pattern: "* * * * *",
      name: "testMethod",
      method: "testMethod",
      opts: {},
    });
  });

  it("should register a cron job with options", () => {
    @JobController("test")
    class TestController {
      @Cron("0 0 * * *", { name: "custom-name" })
      // oxlint-disable-next-line eslint/class-methods-use-this -- Decorated TsED handlers must remain prototype methods for discovery.
      dailyJob() {}
    }

    const store = Store.from(TestController).get<JobStore>(MONQUE);

    expect(store.cronJobs).toHaveLength(1);
    expect(store.cronJobs[0]).toStrictEqual({
      pattern: "0 0 * * *",
      name: "custom-name",
      method: "dailyJob",
      opts: {
        name: "custom-name",
      },
    });
  });

  it("should register multiple cron jobs", () => {
    @JobController("test")
    class TestController {
      @Cron("* * * * *")
      // oxlint-disable-next-line eslint/class-methods-use-this -- Decorated TsED handlers must remain prototype methods for discovery.
      job1() {}

      @Cron("@daily")
      // oxlint-disable-next-line eslint/class-methods-use-this -- Decorated TsED handlers must remain prototype methods for discovery.
      job2() {}
    }

    const store = Store.from(TestController).get<JobStore>(MONQUE);

    expect(store.cronJobs).toHaveLength(2);
    expect(store.cronJobs[0]?.method).toBe("job1");
    expect(store.cronJobs[1]?.method).toBe("job2");
  });

  it("should preserve existing jobs in the store", () => {
    // Mock existing store
    // oxlint-disable-next-line typescript/no-extraneous-class -- TsED metadata and DI tokens require a distinct constructor.
    class TestTarget {}
    const store = Store.from(TestTarget);
    store.set(MONQUE, {
      type: "controller",
      jobs: [{ name: "existing", method: "existing", opts: {} }],
      cronJobs: [],
    });

    // Apply decorator manually
    const decorator = Cron("* * * * *");
    decorator(TestTarget.prototype, "newJob", {
      value: () => {},
    });

    const updatedStore = store.get<JobStore>(MONQUE);

    expect(updatedStore.jobs).toHaveLength(1);
    expect(updatedStore.cronJobs).toHaveLength(1);
  });

  it("should handle missing cronJobs array in existing store", () => {
    // oxlint-disable-next-line typescript/no-extraneous-class -- TsED metadata and DI tokens require a distinct constructor.
    class TestClass {}
    const store = Store.from(TestClass);
    // Seed store with partial object missing 'cronJobs'
    store.set(MONQUE, { type: "controller" });

    // Apply decorator manually
    const decorator = Cron("* * * * *");
    decorator(TestClass.prototype, "cronMethod", {});

    const res = store.get<JobStore>(MONQUE);
    expect(res.cronJobs).toHaveLength(1);
  });
});
