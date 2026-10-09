import type { Document, WithId } from "mongodb";

import type { PersistedJob } from "./types.js";

const OPTIONAL_JOB_FIELDS = [
  "lockedAt",
  "claimedBy",
  "claimId",
  "leaseExpiresAt",
  "lastHeartbeat",
  "heartbeatInterval",
  "failReason",
  "repeatInterval",
  "timezone",
  "uniqueKey",
] as const satisfies readonly (keyof PersistedJob)[];
type OptionalJobField = (typeof OPTIONAL_JOB_FIELDS)[number];

const copyOptionalField = <T, K extends OptionalJobField>(
  target: PersistedJob<T>,
  field: K,
  value: PersistedJob<T>[K],
): void => {
  target[field] = value;
};

/**
 * Convert a raw MongoDB document to a strongly-typed {@link PersistedJob}.
 *
 * Maps required fields directly and conditionally includes optional fields
 * only when they are present in the document (`!== undefined`).
 *
 * Not part of the public API.
 * @internal
 * @template T - The job data payload type
 * @param doc - The raw MongoDB document with `_id`
 * @returns A strongly-typed PersistedJob object with guaranteed `_id`
 */
export const documentToPersistedJob = <T = unknown>(doc: WithId<Document>): PersistedJob<T> => {
  // SAFETY: Monque writes the metadata shape; payload T remains the caller's contract.
  // This projection preserves legacy stored values instead of adding validation here.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The MongoDB Document boundary erases the persisted job and generic payload types.
  const source = doc as PersistedJob<T>;
  const job: PersistedJob<T> = {
    _id: source._id,
    name: source.name,
    data: source.data,
    status: source.status,
    priority: source.priority ?? 0,
    nextRunAt: source.nextRunAt,
    failCount: source.failCount,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
  // Only set optional properties if they exist
  for (const field of OPTIONAL_JOB_FIELDS) {
    if (source[field] !== undefined) {
      copyOptionalField(job, field, source[field]);
    }
  }
  return job;
};
