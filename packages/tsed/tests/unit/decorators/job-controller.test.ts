/* oxlint-disable eslint/max-classes-per-file -- Each scenario needs fresh decorated constructors to isolate global TsED metadata. */
import { Store } from "@tsed/core";
import { Provider, ProviderScope } from "@tsed/di";
import { describe, expect, it } from "vite-plus/test";

import { MONQUE, ProviderTypes } from "@/constants";
import { JobController } from "@/decorators";

describe("@JobController", () => {
  it("registers a singleton job controller with empty job metadata", () => {
    @JobController()
    // oxlint-disable-next-line typescript/no-extraneous-class -- TsED metadata and DI tokens require a distinct constructor.
    class TestJob {}

    const provider = Provider.Registry.get(TestJob);
    expect(provider?.type).toBe(ProviderTypes.JOB_CONTROLLER);
    expect(provider?.scope).toBe(ProviderScope.SINGLETON);
    expect(Store.from(TestJob).get(MONQUE)).toStrictEqual({
      type: "controller",
      jobs: [],
      cronJobs: [],
    });
  });

  it("stores the supplied namespace", () => {
    @JobController("email")
    // oxlint-disable-next-line typescript/no-extraneous-class -- TsED metadata and DI tokens require a distinct constructor.
    class EmailJob {}

    expect(Store.from(EmailJob).get(MONQUE)).toMatchObject({ namespace: "email" });
  });
});
