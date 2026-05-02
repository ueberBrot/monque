import { JobStatus, type PersistedJob } from '@/jobs';

import type { SchedulerContext } from './types.js';

/**
 * Internal service for selecting and claiming runnable jobs.
 *
 * Keeps MongoDB atomic claim semantics behind a narrow interface so polling can focus on
 * worker capacity and execution flow.
 *
 * @internal Not part of public API.
 */
export class JobSelection {
	constructor(private readonly ctx: SchedulerContext) {}

	/**
	 * Atomically acquire the earliest due pending job for a worker.
	 *
	 * Returns `null` when the scheduler is stopping or no runnable job is available.
	 */
	async acquireNext(name: string): Promise<PersistedJob | null> {
		if (!this.ctx.isRunning()) {
			return null;
		}

		const now = new Date();

		const result = await this.ctx.collection.findOneAndUpdate(
			{
				name,
				status: JobStatus.PENDING,
				nextRunAt: { $lte: now },
			},
			{
				$set: {
					status: JobStatus.PROCESSING,
					claimedBy: this.ctx.instanceId,
					lockedAt: now,
					lastHeartbeat: now,
					heartbeatInterval: this.ctx.options.heartbeatInterval,
					updatedAt: now,
				},
			},
			{
				sort: { nextRunAt: 1 },
				returnDocument: 'after',
			},
		);

		if (!result) {
			return null;
		}

		return this.ctx.documentToPersistedJob(result);
	}
}
