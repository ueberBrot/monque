import { ObjectId } from 'mongodb';
import { beforeEach, describe, expect, it } from 'vitest';

import {
	isCompletedJob,
	isFailedJob,
	isPendingJob,
	isPersistedJob,
	isProcessingJob,
	isRecurringJob,
	isValidJobStatus,
	type Job,
	JobStatus,
	type PersistedJob,
} from '@/jobs';

describe('job guards', () => {
	let baseJob: Job;

	beforeEach(() => {
		baseJob = {
			name: 'test-job',
			data: { foo: 'bar' },
			status: JobStatus.PENDING,
			nextRunAt: new Date(),
			failCount: 0,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
	});

	describe('isPersistedJob', () => {
		it('should return true for job with _id', () => {
			const persistedJob: PersistedJob = {
				...baseJob,
				_id: new ObjectId(),
			};

			expect(isPersistedJob(persistedJob)).toBe(true);
		});

		it('should return false for job without _id', () => {
			expect(isPersistedJob(baseJob)).toBe(false);
		});

		it('should return false when _id is undefined', () => {
			// Job without _id property (same as baseJob)
			expect(isPersistedJob(baseJob)).toBe(false);
		});

		it('should return false when _id is null', () => {
			const jobWithNullId = {
				...baseJob,
				_id: null as unknown as ObjectId,
			};

			expect(isPersistedJob(jobWithNullId)).toBe(false);
		});

		it('should narrow type to PersistedJob when true', () => {
			const job: Job = {
				...baseJob,
				_id: new ObjectId(),
			};

			if (isPersistedJob(job)) {
				// This should compile without errors - TypeScript knows _id exists
				const id: ObjectId = job._id;
				expect(id).toBeInstanceOf(ObjectId);
			} else {
				throw new Error('Should have been persisted');
			}
		});
	});

	describe('isValidJobStatus', () => {
		it('should return true for PENDING status', () => {
			expect(isValidJobStatus(JobStatus.PENDING)).toBe(true);
			expect(isValidJobStatus('pending')).toBe(true);
		});

		it('should return true for PROCESSING status', () => {
			expect(isValidJobStatus(JobStatus.PROCESSING)).toBe(true);
			expect(isValidJobStatus('processing')).toBe(true);
		});

		it('should return true for COMPLETED status', () => {
			expect(isValidJobStatus(JobStatus.COMPLETED)).toBe(true);
			expect(isValidJobStatus('completed')).toBe(true);
		});

		it('should return true for FAILED status', () => {
			expect(isValidJobStatus(JobStatus.FAILED)).toBe(true);
			expect(isValidJobStatus('failed')).toBe(true);
		});

		it('should return false for invalid string', () => {
			expect(isValidJobStatus('invalid')).toBe(false);
			expect(isValidJobStatus('PENDING')).toBe(false);
			expect(isValidJobStatus('')).toBe(false);
		});

		it('should return false for non-string types', () => {
			expect(isValidJobStatus(123)).toBe(false);
			expect(isValidJobStatus(null)).toBe(false);
			expect(isValidJobStatus(undefined)).toBe(false);
			expect(isValidJobStatus({})).toBe(false);
			expect(isValidJobStatus([])).toBe(false);
			expect(isValidJobStatus(true)).toBe(false);
		});
	});

	describe('isPendingJob', () => {
		it('should return true when status is PENDING', () => {
			const job: Job = { ...baseJob, status: JobStatus.PENDING };
			expect(isPendingJob(job)).toBe(true);
		});

		it('should return false when status is not PENDING', () => {
			expect(isPendingJob({ ...baseJob, status: JobStatus.PROCESSING })).toBe(false);
			expect(isPendingJob({ ...baseJob, status: JobStatus.COMPLETED })).toBe(false);
			expect(isPendingJob({ ...baseJob, status: JobStatus.FAILED })).toBe(false);
		});
	});

	describe('isProcessingJob', () => {
		it('should return true when status is PROCESSING', () => {
			const job: Job = { ...baseJob, status: JobStatus.PROCESSING };
			expect(isProcessingJob(job)).toBe(true);
		});

		it('should return false when status is not PROCESSING', () => {
			expect(isProcessingJob({ ...baseJob, status: JobStatus.PENDING })).toBe(false);
			expect(isProcessingJob({ ...baseJob, status: JobStatus.COMPLETED })).toBe(false);
			expect(isProcessingJob({ ...baseJob, status: JobStatus.FAILED })).toBe(false);
		});
	});

	describe('isCompletedJob', () => {
		it('should return true when status is COMPLETED', () => {
			const job: Job = { ...baseJob, status: JobStatus.COMPLETED };
			expect(isCompletedJob(job)).toBe(true);
		});

		it('should return false when status is not COMPLETED', () => {
			expect(isCompletedJob({ ...baseJob, status: JobStatus.PENDING })).toBe(false);
			expect(isCompletedJob({ ...baseJob, status: JobStatus.PROCESSING })).toBe(false);
			expect(isCompletedJob({ ...baseJob, status: JobStatus.FAILED })).toBe(false);
		});
	});

	describe('isFailedJob', () => {
		it('should return true when status is FAILED', () => {
			const job: Job = { ...baseJob, status: JobStatus.FAILED };
			expect(isFailedJob(job)).toBe(true);
		});

		it('should return false when status is not FAILED', () => {
			expect(isFailedJob({ ...baseJob, status: JobStatus.PENDING })).toBe(false);
			expect(isFailedJob({ ...baseJob, status: JobStatus.PROCESSING })).toBe(false);
			expect(isFailedJob({ ...baseJob, status: JobStatus.COMPLETED })).toBe(false);
		});
	});

	describe('isRecurringJob', () => {
		it('should return true when repeatInterval is defined', () => {
			const job: Job = { ...baseJob, repeatInterval: '0 * * * *' };
			expect(isRecurringJob(job)).toBe(true);
		});

		it('should return false when repeatInterval is undefined', () => {
			const job: Job = { ...baseJob };
			expect(isRecurringJob(job)).toBe(false);
		});

		it('should return false when repeatInterval is null', () => {
			const job: Job = { ...baseJob, repeatInterval: null as unknown as string };
			expect(isRecurringJob(job)).toBe(false);
		});

		it('should return true for empty string repeatInterval', () => {
			// Even empty string means it's defined as recurring (though invalid cron)
			const job: Job = { ...baseJob, repeatInterval: '' };
			expect(isRecurringJob(job)).toBe(true);
		});
	});

	describe('combined usage', () => {
		it('should allow combining multiple guards', () => {
			const job: PersistedJob = {
				...baseJob,
				_id: new ObjectId(),
				status: JobStatus.FAILED,
				repeatInterval: '0 0 * * *',
			};

			expect(isPersistedJob(job)).toBe(true);
			expect(isFailedJob(job)).toBe(true);
			expect(isRecurringJob(job)).toBe(true);
			expect(isPendingJob(job)).toBe(false);
		});

		it('should work in filter operations', () => {
			const jobs: Job[] = [
				{ ...baseJob, status: JobStatus.PENDING },
				{ ...baseJob, status: JobStatus.PROCESSING },
				{ ...baseJob, status: JobStatus.COMPLETED },
				{ ...baseJob, status: JobStatus.FAILED },
			];

			const pendingJobs = jobs.filter(isPendingJob);
			const failedJobs = jobs.filter(isFailedJob);

			expect(pendingJobs).toHaveLength(1);
			expect(failedJobs).toHaveLength(1);
		});
	});
});
