/**
 * Enum for DI token types used in Monque Ts.ED integration.
 * Used to categorize providers in the DI container.
 */
export enum MonqueTypes {
	/**
	 * Token type for job handler providers.
	 * Applied to classes decorated with @Job or methods decorated with @Job/@Cron.
	 */
	JOB = 'monque:job',

	/**
	 * Token used to identify JobController providers in the DI container.
	 * Controllers group related job handlers with optional namespace prefixing.
	 */
	CONTROLLER = 'monque:controller',
}

/**
 * Metadata key for storing job configuration on controller classes and methods.
 * Used internally by decorators to attach job metadata to classes/methods.
 */
export const MONQUE_METADATA = 'monque:metadata';
