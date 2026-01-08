/**
 * Shared constants for test files to reduce duplication.
 */

export const TEST_CONSTANTS = {
	/** Default collection name for tests */
	COLLECTION_NAME: 'monque_jobs',
	/** Default job name */
	JOB_NAME: 'test-job',
	/** Default job data payload */
	JOB_DATA: { data: 'test' },
	/** Default cron expression (every minute) */
	CRON_EVERY_MINUTE: '* * * * *',
	/** Default cron expression (every hour) */
	CRON_EVERY_HOUR: '0 * * * *',
} as const;
