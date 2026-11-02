import { JobStatus } from "@/jobs";

import type { MonqueOptions } from "../types.js";

/**
 * Resolved Monque options with all defaults applied.
 *
 * Required options have their defaults filled in, while truly optional
 * options (`maxBackoffDelay`, `jobRetention`, `instanceConcurrency`) remain optional.
 */
export interface ResolvedMonqueOptions
  extends
    Required<
      Omit<
        MonqueOptions,
        | "maxBackoffDelay"
        | "jobRetention"
        | "instanceConcurrency"
        | "maxPayloadSize"
        | "leaseDuration"
        | "defaultConcurrency"
        | "maxConcurrency"
      >
    >,
    Pick<
      MonqueOptions,
      // oxlint-disable-next-line sonarjs/max-union-size -- This closed union enumerates the supported domain values without widening the contract.
      | "maxBackoffDelay"
      | "jobRetention"
      | "instanceConcurrency"
      | "maxPayloadSize"
      | "leaseDuration"
    > {
  // Ensure resolved options use the new naming convention
  workerConcurrency: number;
  safetyPollInterval: number;
}

export const RETRYABLE_JOB_STATUSES = [JobStatus.FAILED, JobStatus.CANCELLED] as const;

export type RetryableJobStatusType = (typeof RETRYABLE_JOB_STATUSES)[number];
