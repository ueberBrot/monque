import { ObjectId } from 'mongodb';
import { beforeEach, describe, expect, it } from 'vitest';

import { JobFactory, JobFactoryHelpers } from '@tests/factories';
import {
	isCancelledJob,
	isCompletedJob,
	isFailedJob,
	isPendingJob,
	isPersistedJob,
	isProcessingJob,
	isRecurringJob,
	isValidJobStatus,
	type Job,
	JobStatus,
} from '@/jobs';

describe('job guards', () => {
	let baseJob: Job;

	beforeEach(() => {
		baseJob = JobFactory.build();
	});

	describe('isPersistedJob', () => {
		it('should return true for job with _id', () => {
			const persistedJob = JobFactory.build();
			expect(isPersistedJob(persistedJob)).toBe(true);
		});

		it('should return false for job without _id', () => {
			const jobWithoutId = { ...baseJob };
			delete jobWithoutId._id;
			expect(isPersistedJob(jobWithoutId)).toBe(false);
		});

		it('should return false when _id is undefined', () => {
			const jobWithoutId = { ...baseJob };
			delete jobWithoutId._id;
			expect(isPersistedJob(jobWithoutId)).toBe(false);
		});

		it('should return false when _id is null', () => {
			const jobWithNullId = {
				...baseJob,
				_id: null as unknown as ObjectId,
			};

			expect(isPersistedJob(jobWithNullId)).toBe(false);
		});

		it('should narrow type to PersistedJob when true', () => {
			const job = JobFactory.build();

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
			const job = JobFactory.build({ status: JobStatus.PENDING });
			expect(isPendingJob(job)).toBe(true);
		});

		it('should return false when status is not PENDING', () => {
			expect(isPendingJob(JobFactoryHelpers.processing())).toBe(false);
			expect(isPendingJob(JobFactoryHelpers.completed())).toBe(false);
			expect(isPendingJob(JobFactoryHelpers.failed())).toBe(false);
		});
	});

	describe('isProcessingJob', () => {
		it('should return true when status is PROCESSING', () => {
			const job = JobFactoryHelpers.processing();
			expect(isProcessingJob(job)).toBe(true);
		});

		it('should return false when status is not PROCESSING', () => {
			expect(isProcessingJob(JobFactory.build({ status: JobStatus.PENDING }))).toBe(false);
			expect(isProcessingJob(JobFactoryHelpers.completed())).toBe(false);
			expect(isProcessingJob(JobFactoryHelpers.failed())).toBe(false);
		});
	});

	describe('isCompletedJob', () => {
		it('should return true when status is COMPLETED', () => {
			const job = JobFactoryHelpers.completed();
			expect(isCompletedJob(job)).toBe(true);
		});

		it('should return false when status is not COMPLETED', () => {
			expect(isCompletedJob(JobFactory.build({ status: JobStatus.PENDING }))).toBe(false);
			expect(isCompletedJob(JobFactoryHelpers.processing())).toBe(false);
			expect(isCompletedJob(JobFactoryHelpers.failed())).toBe(false);
		});
	});

	describe('isFailedJob', () => {
		it('should return true when status is FAILED', () => {
			const job = JobFactoryHelpers.failed();
			expect(isFailedJob(job)).toBe(true);
		});

		it('should return false when status is not FAILED', () => {
			expect(isFailedJob(JobFactory.build({ status: JobStatus.PENDING }))).toBe(false);
			expect(isFailedJob(JobFactoryHelpers.processing())).toBe(false);
			expect(isFailedJob(JobFactoryHelpers.completed())).toBe(false);
		});
	});

	describe('isCancelledJob', () => {
		it('should return true when status is CANCELLED', () => {
			const job = JobFactoryHelpers.cancelled();
			expect(isCancelledJob(job)).toBe(true);
		});

		it('should return false when status is not CANCELLED', () => {
			expect(isCancelledJob(JobFactory.build({ status: JobStatus.PENDING }))).toBe(false);
			expect(isCancelledJob(JobFactoryHelpers.processing())).toBe(false);
			expect(isCancelledJob(JobFactoryHelpers.completed())).toBe(false);
			expect(isCancelledJob(JobFactoryHelpers.failed())).toBe(false);
		});
	});

	describe('isRecurringJob', () => {
		it('should return true when repeatInterval is defined', () => {
			const job = JobFactory.build({ repeatInterval: '0 * * * *' });
			expect(isRecurringJob(job)).toBe(true);
		});

		it('should return false when repeatInterval is undefined', () => {
			const job = JobFactory.build();
			expect(isRecurringJob(job)).toBe(false);
		});

		it('should return false when repeatInterval is null', () => {
			const job = JobFactory.build({ repeatInterval: null as unknown as string });
			expect(isRecurringJob(job)).toBe(false);
		});

		it('should return true for empty string repeatInterval', () => {
			// Even empty string means it's defined as recurring (though invalid cron)
			const job = JobFactory.build({ repeatInterval: '' });
			expect(isRecurringJob(job)).toBe(true);
		});
	});

	describe('combined usage', () => {
		it('should allow combining multiple guards', () => {
			const job = JobFactoryHelpers.failed({
				repeatInterval: '0 0 * * *',
			});

			expect(isPersistedJob(job)).toBe(true);
			expect(isFailedJob(job)).toBe(true);
			expect(isRecurringJob(job)).toBe(true);
			expect(isPendingJob(job)).toBe(false);
		});

		it('should work in filter operations', () => {
			const jobs: Job[] = [
				JobFactory.build({ status: JobStatus.PENDING }),
				JobFactoryHelpers.processing(),
				JobFactoryHelpers.completed(),
				JobFactoryHelpers.failed(),
			];

			const pendingJobs = jobs.filter(isPendingJob);
			const failedJobs = jobs.filter(isFailedJob);

			expect(pendingJobs).toHaveLength(1);
			expect(failedJobs).toHaveLength(1);
		});
	});
});
