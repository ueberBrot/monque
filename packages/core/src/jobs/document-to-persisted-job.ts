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

/**
 * Convert a raw MongoDB document to a strongly-typed {@link PersistedJob}.
 *
 * Maps required fields directly and conditionally includes optional fields
 * only when they are present in the document (`!== undefined`).
 *
 * @internal Not part of the public API.
 * @template T - The job data payload type
 * @param doc - The raw MongoDB document with `_id`
 * @returns A strongly-typed PersistedJob object with guaranteed `_id`
 */
export function documentToPersistedJob<T = unknown>(doc: WithId<Document>): PersistedJob<T> {
  const job: PersistedJob<T> = {
    _id: doc._id,
    name: doc["name"],
    data: doc["data"],
    status: doc["status"],
    nextRunAt: doc["nextRunAt"],
    failCount: doc["failCount"],
    createdAt: doc["createdAt"],
    updatedAt: doc["updatedAt"],
  };

  // Only set optional properties if they exist
  const optionalFields: Partial<Record<(typeof OPTIONAL_JOB_FIELDS)[number], unknown>> = job;
  for (const field of OPTIONAL_JOB_FIELDS) {
    if (doc[field] !== undefined) optionalFields[field] = doc[field];
  }

  return job;
}
