import type { Document, WithId } from 'mongodb';

import type { PersistedJob } from './types.js';

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
		name: doc['name'],
		data: doc['data'],
		status: doc['status'],
		nextRunAt: doc['nextRunAt'],
		failCount: doc['failCount'],
		createdAt: doc['createdAt'],
		updatedAt: doc['updatedAt'],
	};

	// Only set optional properties if they exist
	if (doc['lockedAt'] !== undefined) {
		job.lockedAt = doc['lockedAt'];
	}
	if (doc['claimedBy'] !== undefined) {
		job.claimedBy = doc['claimedBy'];
	}
	if (doc['lastHeartbeat'] !== undefined) {
		job.lastHeartbeat = doc['lastHeartbeat'];
	}
	if (doc['heartbeatInterval'] !== undefined) {
		job.heartbeatInterval = doc['heartbeatInterval'];
	}
	if (doc['failReason'] !== undefined) {
		job.failReason = doc['failReason'];
	}
	if (doc['repeatInterval'] !== undefined) {
		job.repeatInterval = doc['repeatInterval'];
	}
	if (doc['uniqueKey'] !== undefined) {
		job.uniqueKey = doc['uniqueKey'];
	}

	return job;
}
