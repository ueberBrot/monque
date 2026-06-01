import { ObjectId } from 'mongodb';

import { JobStatus, type PersistedJob } from '@/jobs';
import { JobStateError } from '@/shared';

import {
	type CancelledJob,
	RETRYABLE_JOB_STATUSES,
	type RetriedJob,
	type RetryableJobStatusType,
	type SchedulerContext,
} from './types.js';

/**
 * Internal module for atomic management-driven job transitions.
 *
 * Keeps public management actions, status preconditions, retry scheduling, and
 * pending-job notification local to one implementation.
 *
 * @internal Not part of public API.
 */
export class JobStateTransitions {
	constructor(private readonly ctx: SchedulerContext) {}

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
