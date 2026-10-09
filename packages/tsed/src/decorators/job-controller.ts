/**
 * `@JobController` class decorator
 *
 * Marks a class as containing job methods and registers it with the Ts.ED DI container.
 * Jobs in the class will have their job names prefixed with the namespace.
 *
 * @param namespace - Optional prefix for all job names in this controller.
 *                    When set, job names become "{namespace}.{name}".
 *
 * @example
 * ```typescript
 * @JobController("email")
 * export class EmailJobs {
 *   @Job("send")  // Registered as "email.send"
 *   async send(job: Job<EmailPayload>) { }
 * }
 * ```
 */
import { Store } from "@tsed/core";
import { Injectable } from "@tsed/di";

import { MONQUE, ProviderTypes } from "@/constants";

import type { JobStore } from "./types.js";

/**
 * Class decorator that registers a class as a job controller.
 *
 * @param namespace - Optional namespace prefix for job names
 */
export const JobController = function JobController(namespace?: string): ClassDecorator {
  const registerProvider = Injectable({ type: ProviderTypes.JOB_CONTROLLER });
  return (target) => {
    registerProvider(target);
    const store = Store.from(target);

    // Get existing store or create new one
    const existing = store.get<Partial<JobStore> | undefined>(MONQUE) ?? {};

    // Merge with new metadata, only include namespace if defined
    const jobStore: JobStore = {
      type: "controller",
      ...(namespace !== undefined && { namespace }),
      jobs: existing.jobs ?? [],
      cronJobs: existing.cronJobs ?? [],
    };

    store.set(MONQUE, jobStore);
  };
};
