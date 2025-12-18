import { faker } from '@faker-js/faker';
import { Factory } from 'fishery';
import { ObjectId } from 'mongodb';
import { JobStatus, type PersistedJob } from '@/types.js';
import { TEST_CONSTANTS } from '@tests/setup/constants.js';

/**
 * Transient parameters for JobFactory.
 * These don't end up in the built object but control factory behavior.
 */
interface JobTransientParams {
	/** Generate custom data shape instead of default email/userId */
	withData?: Record<string, unknown>;
}

/**
 * Factory for creating test Job objects with realistic fake data.
 *
 * @example
 * ```typescript
 * // Basic usage - creates a pending job with random data
 * const job = JobFactory.build();
 *
 * // Override specific fields
 * const processingJob = JobFactory.build({ status: JobStatus.PROCESSING });
 *
 * // Use transient params for custom data
 * const emailJob = JobFactory.build({}, { transient: { withData: { to: 'test@example.com' } } });
 *
 * // Use status-specific helpers
 * const failed = JobFactoryHelpers.failed();
 * const processing = JobFactoryHelpers.processing();
 * ```
 */
export const JobFactory = Factory.define<PersistedJob<unknown>, JobTransientParams>(
	({ transientParams }) => {
		const data = transientParams.withData ?? {
			email: faker.internet.email(),
			userId: faker.string.uuid(),
		};

		return {
			_id: new ObjectId(faker.database.mongodbObjectId()),
			name: TEST_CONSTANTS.JOB_NAME,
			data,
			status: JobStatus.PENDING,
			failCount: 0,
			createdAt: new Date(),
			updatedAt: new Date(),
			nextRunAt: new Date(),
		};
	},
);

/** Convenience builders for common job states */
export const JobFactoryHelpers = {
	/** Build a job in PROCESSING state with lockedAt set */
	processing: (overrides?: Partial<PersistedJob<unknown>>) =>
		JobFactory.build({
			status: JobStatus.PROCESSING,
			lockedAt: new Date(),
			...overrides,
		}),

	/** Build a job in COMPLETED state */
	completed: (overrides?: Partial<PersistedJob<unknown>>) =>
		JobFactory.build({
			status: JobStatus.COMPLETED,
			lockedAt: null,
			...overrides,
		}),

	/** Build a job in FAILED state with failCount and failReason */
	failed: (overrides?: Partial<PersistedJob<unknown>>) =>
		JobFactory.build({
			status: JobStatus.FAILED,
			failCount: 10,
			failReason: 'Max retries exceeded',
			lockedAt: null,
			...overrides,
		}),

	/** Build a job with custom data payload */
	withData: <T extends Record<string, unknown>>(data: T, overrides?: Partial<PersistedJob<T>>) =>
		JobFactory.build(overrides as Partial<PersistedJob<unknown>>, {
			transient: { withData: data },
		}) as PersistedJob<T>,
};
