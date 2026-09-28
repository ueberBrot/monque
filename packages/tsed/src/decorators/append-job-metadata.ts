import { Store } from "@tsed/core";

import { MONQUE } from "@/constants";

import type { CronMetadata, JobMetadata, JobStore } from "./types.js";

export function appendJobMetadata(target: object, metadata: JobMetadata | CronMetadata): void {
  const store = Store.from(target.constructor);
  const existing = store.get<Partial<JobStore>>(MONQUE) || {
    type: "controller",
    jobs: [],
    cronJobs: [],
  };
  const registrations =
    "pattern" in metadata
      ? { cronJobs: [...(existing.cronJobs || []), metadata] }
      : { jobs: [...(existing.jobs || []), metadata] };
  store.set(MONQUE, { ...existing, ...registrations });
}
