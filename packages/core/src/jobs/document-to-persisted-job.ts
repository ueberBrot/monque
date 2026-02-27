import type { Document, WithId } from 'mongodb';

import type { JobStatusType, PersistedJob } from './types.js';

/**
 * Type-level exhaustiveness guard — ensures every key of {@link PersistedJob} is accounted
 * for in the mapper below. If a new field is added to the `Job` interface but not listed
 * here, TypeScript emits a compile error showing the missing key(s).
 *
 * @internal Compile-time only, tree-shaken in production.
 */
const _HANDLED_KEYS = [
	'_id',
	'name',
	'data',
	'status',
	'nextRunAt',
	'failCount',
	'createdAt',
	'updatedAt',
	'lockedAt',
	'claimedBy',
	'lastHeartbeat',
	'heartbeatInterval',
	'failReason',
	'repeatInterval',
	'uniqueKey',
] as const satisfies readonly (keyof PersistedJob)[];

// Reverse check: ensure no PersistedJob key is missing from _HANDLED_KEYS
type _AssertAllKeysHandled =
	Exclude<keyof PersistedJob, (typeof _HANDLED_KEYS)[number]> extends never
		? true
		: {
				error: 'documentToPersistedJob is missing keys';
				missing: Exclude<keyof PersistedJob, (typeof _HANDLED_KEYS)[number]>;
			};
/** @internal Compile-time assertion — always `true` when all keys are handled. */
export const _exhaustivenessCheck: _AssertAllKeysHandled = true;

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
export function documentToPersistedJob<T>(doc: WithId<Document>): PersistedJob<T> {
	const job: PersistedJob<T> = {
		_id: doc._id,
		name: doc['name'] as string,
		data: doc['data'] as T,
		status: doc['status'] as JobStatusType,
		nextRunAt: doc['nextRunAt'] as Date,
		failCount: doc['failCount'] as number,
		createdAt: doc['createdAt'] as Date,
		updatedAt: doc['updatedAt'] as Date,
	};

	// Only set optional properties if they exist
	if (doc['lockedAt'] !== undefined) {
		job.lockedAt = doc['lockedAt'] as Date | null;
	}
	if (doc['claimedBy'] !== undefined) {
		job.claimedBy = doc['claimedBy'] as string | null;
	}
	if (doc['lastHeartbeat'] !== undefined) {
		job.lastHeartbeat = doc['lastHeartbeat'] as Date | null;
	}
	if (doc['heartbeatInterval'] !== undefined) {
		job.heartbeatInterval = doc['heartbeatInterval'] as number;
	}
	if (doc['failReason'] !== undefined) {
		job.failReason = doc['failReason'] as string;
	}
	if (doc['repeatInterval'] !== undefined) {
		job.repeatInterval = doc['repeatInterval'] as string;
	}
	if (doc['uniqueKey'] !== undefined) {
		job.uniqueKey = doc['uniqueKey'] as string;
	}

	return job;
}
