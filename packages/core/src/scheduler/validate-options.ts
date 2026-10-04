import * as Schema from "effect/Schema";

import { MonqueError } from "@/shared";
import type { RetryOptions } from "@/workers";

import type { ResolvedMonqueOptions } from "./services/index.js";

const MAX_TIMER_DELAY = 2_147_483_647;
const isNonNegativeSafeInteger = Schema.is(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)));

export function validateIntegerOption(name: string, value: number | undefined): void {
  if (value !== undefined && !isNonNegativeSafeInteger(value)) {
    throw new MonqueError(`${name} must be a non-negative safe integer`);
  }
}

function numberRange(min: number, max: number) {
  return {
    min,
    max,
    isValid: Schema.is(Schema.Finite.check(Schema.isBetween({ minimum: min, maximum: max }))),
  };
}

const nonNegativeNumber = numberRange(0, Number.MAX_VALUE);
const positiveTimerDelay = numberRange(1, MAX_TIMER_DELAY);
const nonNegativeTimerDelay = numberRange(0, MAX_TIMER_DELAY);

function validateNumberOption(
  name: string,
  value: number | undefined,
  range = nonNegativeNumber,
): void {
  if (value !== undefined && !range.isValid(value)) {
    throw new MonqueError(`${name} must be a finite number between ${range.min} and ${range.max}`);
  }
}

export function validateRetryOptions(options: RetryOptions): void {
  validateIntegerOption("maxRetries", options.maxRetries);
  validateNumberOption("baseRetryInterval", options.baseRetryInterval);
  validateNumberOption("maxBackoffDelay", options.maxBackoffDelay);
}

export function validateOptions(options: ResolvedMonqueOptions): void {
  validateNumberOption("pollInterval", options.pollInterval, positiveTimerDelay);
  validateNumberOption("safetyPollInterval", options.safetyPollInterval, positiveTimerDelay);
  validateNumberOption("heartbeatInterval", options.heartbeatInterval, positiveTimerDelay);
  validateNumberOption("shutdownTimeout", options.shutdownTimeout, nonNegativeTimerDelay);
  validateIntegerOption("workerConcurrency", options.workerConcurrency);
  validateIntegerOption("instanceConcurrency", options.instanceConcurrency);
  validateRetryOptions(options);
  validateIntegerOption("maxPayloadSize", options.maxPayloadSize);
  validateNumberOption("lockTimeout", options.lockTimeout);
  validateNumberOption("leaseDuration", options.leaseDuration, positiveTimerDelay);
  if (options.leaseDuration !== undefined && options.leaseDuration <= options.heartbeatInterval) {
    throw new MonqueError("leaseDuration must exceed heartbeatInterval");
  }
  validateNumberOption("statsCacheTtlMs", options.statsCacheTtlMs);
  validateNumberOption("jobRetention.completed", options.jobRetention?.completed);
  validateNumberOption("jobRetention.failed", options.jobRetention?.failed);
  validateNumberOption("jobRetention.cancelled", options.jobRetention?.cancelled);
  validateNumberOption("jobRetention.interval", options.jobRetention?.interval, positiveTimerDelay);
}
