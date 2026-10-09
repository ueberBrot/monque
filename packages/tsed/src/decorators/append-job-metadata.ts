import { Store } from "@tsed/core";

import { MONQUE } from "@/constants";

import type { CronMetadata, JobDecoratorTarget, JobMetadata, JobStore } from "./types.js";

export const appendJobMetadata = function appendJobMetadata(
  target: JobDecoratorTarget,
  metadata: JobMetadata | CronMetadata,
): void {
  const store = Store.from(target.constructor);
  const existing = store.get<Partial<JobStore> | undefined>(MONQUE) ?? {
    type: "controller",
    jobs: [],
    cronJobs: [],
  };
  const registrations =
    "pattern" in metadata
      ? { cronJobs: [...(existing.cronJobs ?? []), metadata] }
      : { jobs: [...(existing.jobs ?? []), metadata] };
  store.set(MONQUE, { ...existing, ...registrations });
};
