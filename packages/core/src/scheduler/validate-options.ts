import { MonqueError } from "@/shared";
import type { RetryOptions } from "@/workers";

import type { ResolvedMonqueOptions } from "./services/index.js";

const MAX_TIMER_DELAY = 2_147_483_647;

export function validateIntegerOption(name: string, value: number | undefined): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
    throw new MonqueError(`${name} must be a non-negative safe integer`);
  }
}

function validateNumberOption(
  name: string,
  value: number | undefined,
  min = 0,
  max = Number.MAX_VALUE,
): void {
  if (value !== undefined && (!Number.isFinite(value) || value < min || value > max)) {
    throw new MonqueError(`${name} must be a finite number between ${min} and ${max}`);
  }
}

export function validateRetryOptions(options: RetryOptions): void {
  validateIntegerOption("maxRetries", options.maxRetries);
  validateNumberOption("baseRetryInterval", options.baseRetryInterval);
  validateNumberOption("maxBackoffDelay", options.maxBackoffDelay);
}

export function validateOptions(options: ResolvedMonqueOptions): void {
  validateNumberOption("pollInterval", options.pollInterval, 1, MAX_TIMER_DELAY);
  validateNumberOption("safetyPollInterval", options.safetyPollInterval, 1, MAX_TIMER_DELAY);
  validateNumberOption("heartbeatInterval", options.heartbeatInterval, 1, MAX_TIMER_DELAY);
  validateNumberOption("shutdownTimeout", options.shutdownTimeout, 0, MAX_TIMER_DELAY);
  validateIntegerOption("workerConcurrency", options.workerConcurrency);
  validateIntegerOption("instanceConcurrency", options.instanceConcurrency);
  validateRetryOptions(options);
  validateIntegerOption("maxPayloadSize", options.maxPayloadSize);
  validateNumberOption("lockTimeout", options.lockTimeout);
  validateNumberOption("leaseDuration", options.leaseDuration, 1, MAX_TIMER_DELAY);
  if (options.leaseDuration !== undefined && options.leaseDuration <= options.heartbeatInterval) {
    throw new MonqueError("leaseDuration must exceed heartbeatInterval");
  }
  validateNumberOption("statsCacheTtlMs", options.statsCacheTtlMs);
  validateNumberOption("jobRetention.completed", options.jobRetention?.completed);
  validateNumberOption("jobRetention.failed", options.jobRetention?.failed);
  validateNumberOption("jobRetention.cancelled", options.jobRetention?.cancelled);
  validateNumberOption("jobRetention.interval", options.jobRetention?.interval, 1, MAX_TIMER_DELAY);
}
