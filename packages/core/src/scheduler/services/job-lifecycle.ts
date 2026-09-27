import { randomUUID } from 'node:crypto';
import type { Document, Filter } from 'mongodb';

import { isPersistedJob, type Job, JobStatus, type PersistedJob } from '@/jobs';
import { ConnectionError, calculateBackoff, getNextCronDate, NonRetryableError } from '@/shared';

import type { SchedulerContext } from './types.js';

/**
 * Concentrates ownership-sensitive job lifecycle operations.
 *
 * Keeps Claim and Owned Job persistence invariants local so callers do not need
 * to know the backing MongoDB fields.
 *
 * @internal Not part of public API.
 */
export class JobLifecycle {
	constructor(private readonly ctx: SchedulerContext) {}

	/**
	 * Atomically claim the earliest due pending job for a Worker.
	 */
	async claimNext(name: string): Promise<PersistedJob | null> {
		if (!this.ctx.isRunning()) {
			return null;
		}

		const now = new Date();
		const { leaseDuration } = this.ctx.options;
		const claim = {
			status: JobStatus.PROCESSING,
			claimedBy: this.ctx.instanceId,
			claimId: randomUUID(),
			lockedAt: now,
			lastHeartbeat: now,
			heartbeatInterval: this.ctx.options.heartbeatInterval,
			updatedAt: now,
		};
		const result = await this.ctx.collection.findOneAndUpdate(
			{
				name,
				status: JobStatus.PENDING,
				nextRunAt: { $lte: now },
			},
			leaseDuration === undefined
				? { $set: claim, $unset: { leaseExpiresAt: '' } }
				: [
						{
							$set: {
								...claim,
								claimedBy: { $literal: this.ctx.instanceId },
								lockedAt: '$$NOW',
								lastHeartbeat: '$$NOW',
								updatedAt: '$$NOW',
								leaseExpiresAt: { $add: ['$$NOW', leaseDuration] },
							},
						},
					],
			{
				sort: { nextRunAt: 1 },
				returnDocument: 'after',
			},
		);

		return result ? this.ctx.documentToPersistedJob(result) : null;
	}

	/**
	 * Release a just-claimed job when processing cannot start.
	 */
	async releaseOwnedClaim(job: PersistedJob): Promise<void> {
		await this.ctx.collection.updateOne(this.ownedJobFilter(job), {
			$set: {
				status: JobStatus.PENDING,
				updatedAt: new Date(),
			},
			$unset: this.claimCleanupFields(),
		});
	}

	/**
	 * Complete an Owned Job or reschedule its recurring next run.
	 */
	async completeOwned(job: Job): Promise<PersistedJob | null> {
		if (!isPersistedJob(job)) {
			return null;
		}

		const now = new Date();

		if (job.repeatInterval) {
			const nextRunAt = getNextCronDate(job.repeatInterval, undefined, job.timezone);
			const result = await this.ctx.collection.findOneAndUpdate(
				this.ownedJobFilter(job),
				{
					$set: {
						status: JobStatus.PENDING,
						nextRunAt,
						failCount: 0,
						updatedAt: now,
					},
					$unset: {
						...this.claimCleanupFields(),
						failReason: '',
					},
				},
				{ returnDocument: 'after' },
			);

			if (!result) {
				return null;
			}

			const persistedJob = this.ctx.documentToPersistedJob(result);
			this.ctx.notifyPendingJob(persistedJob.name, persistedJob.nextRunAt);
			return persistedJob;
		}

		const result = await this.ctx.collection.findOneAndUpdate(
			this.ownedJobFilter(job),
			{
				$set: {
					status: JobStatus.COMPLETED,
					updatedAt: now,
				},
				$unset: {
					...this.claimCleanupFields(),
					failReason: '',
				},
			},
			{ returnDocument: 'after' },
		);

		return result ? this.ctx.documentToPersistedJob(result) : null;
	}

	/**
	 * Fail an Owned Job, either scheduling a retry or marking it terminal.
	 */
	async failOwned(job: Job, error: Error): Promise<PersistedJob | null> {
		if (!isPersistedJob(job)) {
			return null;
		}

		const now = new Date();
		const newFailCount = job.failCount + 1;

		if (error instanceof NonRetryableError || newFailCount >= this.ctx.options.maxRetries) {
			const result = await this.ctx.collection.findOneAndUpdate(
				this.ownedJobFilter(job),
				{
					$set: {
						status: JobStatus.FAILED,
						failCount: newFailCount,
						failReason: error.message,
						updatedAt: now,
					},
					$unset: this.claimCleanupFields(),
				},
				{ returnDocument: 'after' },
			);

			return result ? this.ctx.documentToPersistedJob(result) : null;
		}

		const nextRunAt = calculateBackoff(
			newFailCount,
			this.ctx.options.baseRetryInterval,
			this.ctx.options.maxBackoffDelay,
		);

		const result = await this.ctx.collection.findOneAndUpdate(
			this.ownedJobFilter(job),
			{
				$set: {
					status: JobStatus.PENDING,
					failCount: newFailCount,
					failReason: error.message,
					nextRunAt,
					updatedAt: now,
				},
				$unset: this.claimCleanupFields(),
			},
			{ returnDocument: 'after' },
		);

		if (!result) {
			return null;
		}

		const persistedJob = this.ctx.documentToPersistedJob(result);
		this.ctx.notifyPendingJob(persistedJob.name, persistedJob.nextRunAt);
		return persistedJob;
	}

	/**
	 * Refresh heartbeat timestamps for jobs owned by this scheduler instance.
	 */
	async updateOwnedHeartbeats(): Promise<void> {
		const claimIds: string[] = [];
		for (const worker of this.ctx.workers.values()) {
			for (const job of worker.activeJobs.values()) {
				if (job.claimId) claimIds.push(job.claimId);
			}
		}
		if (claimIds.length === 0) return;

		const now = new Date();
		const { leaseDuration } = this.ctx.options;
		await this.ctx.collection.updateMany(
			{
				claimedBy: this.ctx.instanceId,
				claimId: { $in: claimIds },
				status: JobStatus.PROCESSING,
				...(leaseDuration === undefined ? {} : { $expr: { $gt: ['$leaseExpiresAt', '$$NOW'] } }),
			},
			leaseDuration === undefined
				? {
						$set: {
							lastHeartbeat: now,
							updatedAt: now,
						},
					}
				: [
						{
							$set: {
								lastHeartbeat: '$$NOW',
								updatedAt: '$$NOW',
								leaseExpiresAt: { $add: ['$$NOW', leaseDuration] },
							},
						},
					],
		);
	}

	/**
	 * Recover processing jobs whose ownership lock has expired.
	 */
	async recoverStaleJobs(): Promise<void> {
		const staleThreshold = new Date(Date.now() - this.ctx.options.lockTimeout);
		const result = await this.ctx.collection.updateMany(
			{
				status: JobStatus.PROCESSING,
				$or: [
					{ leaseExpiresAt: { $exists: false }, lockedAt: { $lt: staleThreshold } },
					{ leaseExpiresAt: { $exists: true }, $expr: { $lte: ['$leaseExpiresAt', '$$NOW'] } },
				],
			},
			{
				$set: {
					status: JobStatus.PENDING,
					updatedAt: new Date(),
				},
				$unset: this.claimCleanupFields(),
			},
		);

		if (result.modifiedCount > 0) {
			this.ctx.emit('stale:recovered', { count: result.modifiedCount });
			this.ctx.notifyPendingJob(undefined, new Date());
		}
	}

	/**
	 * Guard startup against another active scheduler using this instance id.
	 */
	async assertNoActiveInstanceCollision(): Promise<void> {
		const aliveThreshold = new Date(Date.now() - this.ctx.options.heartbeatInterval * 2);
		const activeJob = await this.ctx.collection.findOne({
			claimedBy: this.ctx.instanceId,
			status: JobStatus.PROCESSING,
			lastHeartbeat: { $gte: aliveThreshold },
		});

		if (activeJob) {
			throw new ConnectionError(
				`Another active Monque instance is using schedulerInstanceId "${this.ctx.instanceId}". ` +
					`Found processing job "${activeJob['name']}" with recent heartbeat. ` +
					`Use a unique schedulerInstanceId or wait for the other instance to stop.`,
			);
		}
	}

	/**
	 * MongoDB precondition for mutating a job owned by this scheduler.
	 */
	private ownedJobFilter(job: PersistedJob): Filter<Document> {
		return {
			_id: job._id,
			status: JobStatus.PROCESSING,
			claimedBy: this.ctx.instanceId,
			claimId: job.claimId ?? null,
			...(job.leaseExpiresAt === undefined ? {} : { $expr: { $gt: ['$leaseExpiresAt', '$$NOW'] } }),
		};
	}

	/**
	 * Claim fields removed whenever ownership ends.
	 */
	private claimCleanupFields(): {
		lockedAt: '';
		claimedBy: '';
		claimId: '';
		lastHeartbeat: '';
		leaseExpiresAt: '';
	} {
		return {
			lockedAt: '',
			claimedBy: '',
			claimId: '',
			leaseExpiresAt: '',
			lastHeartbeat: '',
		};
	}
}
