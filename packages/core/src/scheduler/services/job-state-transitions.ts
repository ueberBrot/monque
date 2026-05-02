import { ObjectId } from 'mongodb';

import { isPersistedJob, type Job, JobStatus, type PersistedJob } from '@/jobs';
import { calculateBackoff, getNextCronDate, JobStateError } from '@/shared';

import {
	type CancelledJob,
	RETRYABLE_JOB_STATUSES,
	type RetriedJob,
	type RetryableJobStatusType,
	type SchedulerContext,
} from './types.js';

/**
 * Internal module for atomic job lifecycle transitions.
 *
 * Keeps status preconditions, ownership checks, claim cleanup, retry scheduling,
 * and pending-job notification local to one implementation.
 *
 * @internal Not part of public API.
 */
export class JobStateTransitions {
	constructor(private readonly ctx: SchedulerContext) {}

	async releaseOwnedClaim(job: PersistedJob): Promise<void> {
		await this.ctx.collection.updateOne(
			{ _id: job._id, status: JobStatus.PROCESSING, claimedBy: this.ctx.instanceId },
			{
				$set: {
					status: JobStatus.PENDING,
					updatedAt: new Date(),
				},
				$unset: {
					lockedAt: '',
					claimedBy: '',
					lastHeartbeat: '',
				},
			},
		);
	}

	async completeOwned(job: Job): Promise<PersistedJob | null> {
		if (!isPersistedJob(job)) {
			return null;
		}

		const now = new Date();

		if (job.repeatInterval) {
			const nextRunAt = getNextCronDate(job.repeatInterval);
			const result = await this.ctx.collection.findOneAndUpdate(
				{ _id: job._id, status: JobStatus.PROCESSING, claimedBy: this.ctx.instanceId },
				{
					$set: {
						status: JobStatus.PENDING,
						nextRunAt,
						failCount: 0,
						updatedAt: now,
					},
					$unset: {
						lockedAt: '',
						claimedBy: '',
						lastHeartbeat: '',
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
			{ _id: job._id, status: JobStatus.PROCESSING, claimedBy: this.ctx.instanceId },
			{
				$set: {
					status: JobStatus.COMPLETED,
					updatedAt: now,
				},
				$unset: {
					lockedAt: '',
					claimedBy: '',
					lastHeartbeat: '',
					failReason: '',
				},
			},
			{ returnDocument: 'after' },
		);

		return result ? this.ctx.documentToPersistedJob(result) : null;
	}

	async failOwned(job: Job, error: Error): Promise<PersistedJob | null> {
		if (!isPersistedJob(job)) {
			return null;
		}

		const now = new Date();
		const newFailCount = job.failCount + 1;

		if (newFailCount >= this.ctx.options.maxRetries) {
			const result = await this.ctx.collection.findOneAndUpdate(
				{ _id: job._id, status: JobStatus.PROCESSING, claimedBy: this.ctx.instanceId },
				{
					$set: {
						status: JobStatus.FAILED,
						failCount: newFailCount,
						failReason: error.message,
						updatedAt: now,
					},
					$unset: {
						lockedAt: '',
						claimedBy: '',
						lastHeartbeat: '',
					},
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
			{ _id: job._id, status: JobStatus.PROCESSING, claimedBy: this.ctx.instanceId },
			{
				$set: {
					status: JobStatus.PENDING,
					failCount: newFailCount,
					failReason: error.message,
					nextRunAt,
					updatedAt: now,
				},
				$unset: {
					lockedAt: '',
					claimedBy: '',
					lastHeartbeat: '',
				},
			},
			{ returnDocument: 'after' },
		);

		return result ? this.ctx.documentToPersistedJob(result) : null;
	}

	async cancelPending(jobId: string): Promise<CancelledJob | null> {
		if (!ObjectId.isValid(jobId)) {
			return null;
		}

		const _id = new ObjectId(jobId);
		const result = await this.ctx.collection.findOneAndUpdate(
			{ _id, status: JobStatus.PENDING },
			{
				$set: {
					status: JobStatus.CANCELLED,
					updatedAt: new Date(),
				},
			},
			{ returnDocument: 'after' },
		);

		if (result) {
			return { job: this.ctx.documentToPersistedJob(result), transitioned: true };
		}

		const jobDoc = await this.ctx.collection.findOne({ _id });
		if (!jobDoc) {
			return null;
		}

		if (jobDoc['status'] === JobStatus.CANCELLED) {
			return { job: this.ctx.documentToPersistedJob(jobDoc), transitioned: false };
		}

		throw new JobStateError(
			`Cannot cancel job in status '${jobDoc['status']}'`,
			jobId,
			jobDoc['status'],
			'cancel',
		);
	}

	async retryTerminal(jobId: string): Promise<RetriedJob | null> {
		if (!ObjectId.isValid(jobId)) {
			return null;
		}

		const _id = new ObjectId(jobId);
		const now = new Date();
		const result = await this.ctx.collection.findOneAndUpdate(
			{
				_id,
				status: { $in: RETRYABLE_JOB_STATUSES },
			},
			{
				$set: {
					status: JobStatus.PENDING,
					failCount: 0,
					nextRunAt: now,
					updatedAt: now,
				},
				$unset: {
					failReason: '',
					lockedAt: '',
					claimedBy: '',
					lastHeartbeat: '',
				},
			},
			{ returnDocument: 'before' },
		);

		if (!result) {
			const currentJob = await this.ctx.collection.findOne({ _id });
			if (!currentJob) {
				return null;
			}

			throw new JobStateError(
				`Cannot retry job in status '${currentJob['status']}'`,
				jobId,
				currentJob['status'],
				'retry',
			);
		}

		const previousStatus = result['status'] as RetryableJobStatusType;
		const updatedDoc = { ...result };
		updatedDoc['status'] = JobStatus.PENDING;
		updatedDoc['failCount'] = 0;
		updatedDoc['nextRunAt'] = now;
		updatedDoc['updatedAt'] = now;
		delete updatedDoc['failReason'];
		delete updatedDoc['lockedAt'];
		delete updatedDoc['claimedBy'];
		delete updatedDoc['lastHeartbeat'];

		const job = this.ctx.documentToPersistedJob(updatedDoc);
		this.ctx.notifyPendingJob(job.name, job.nextRunAt);
		return { job, previousStatus };
	}

	async reschedulePending(jobId: string, runAt: Date): Promise<PersistedJob<unknown> | null> {
		if (!ObjectId.isValid(jobId)) {
			return null;
		}

		const _id = new ObjectId(jobId);
		const result = await this.ctx.collection.findOneAndUpdate(
			{ _id, status: JobStatus.PENDING },
			{
				$set: {
					nextRunAt: runAt,
					updatedAt: new Date(),
				},
			},
			{ returnDocument: 'after' },
		);

		if (result) {
			const job = this.ctx.documentToPersistedJob(result);
			this.ctx.notifyPendingJob(job.name, job.nextRunAt);
			return job;
		}

		const currentJobDoc = await this.ctx.collection.findOne({ _id });
		if (!currentJobDoc) {
			return null;
		}

		throw new JobStateError(
			`Cannot reschedule job in status '${currentJobDoc['status']}'`,
			jobId,
			currentJobDoc['status'],
			'reschedule',
		);
	}
}
