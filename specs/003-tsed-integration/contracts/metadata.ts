/**
 * @monque/tsed - Metadata Contracts
 *
 * Internal metadata structures used by decorators and the module.
 * These are not part of the public API but define the data contract
 * between decorators and the module.
 */

import type { WorkerOptions as CoreWorkerOptions, ScheduleOptions } from '@monque/core';

// ─────────────────────────────────────────────────────────────────────────────
// Store Key
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Symbol used to store decorator metadata on class constructors.
 */
export const MONQUE = Symbol.for('monque');

// ─────────────────────────────────────────────────────────────────────────────
// Provider Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Provider type constants for DI scanning.
 *
 * Note: Using string constants instead of enums per Constitution guidelines.
 */
export const ProviderTypes = {
	/** Provider type for @JobController decorated classes */
	JOB_CONTROLLER: 'monque:job-controller',
	/** Provider type for cron job handlers */
	CRON: 'monque:cron',
} as const;

export type ProviderType = (typeof ProviderTypes)[keyof typeof ProviderTypes];

// ─────────────────────────────────────────────────────────────────────────────
// Job Metadata
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Metadata for a single @Job decorated method.
 */
export interface JobMetadata {
	/**
	 * Job name (without namespace prefix).
	 * Combined with controller namespace to form full job name.
	 */
	name: string;

	/**
	 * Method name on the controller class.
	 */
	method: string;

	/**
	 * Job options forwarded to Monque.register().
	 */
	opts: CoreWorkerOptions;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cron Metadata
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for the @Cron method decorator.
 */
export interface CronDecoratorOptions extends ScheduleOptions {
	/**
	 * Override job name (defaults to method name).
	 */
	name?: string;
}

/**
 * Metadata for a single @Cron decorated method.
 */
export interface CronMetadata {
	/**
	 * Cron expression (5-field standard or predefined like @daily).
	 */
	pattern: string;

	/**
	 * Job name (defaults to method name if not specified in options).
	 */
	name: string;

	/**
	 * Method name on the controller class.
	 */
	method: string;

	/**
	 * Schedule options forwarded to Monque.schedule().
	 */
	opts: CronDecoratorOptions;
}

// ─────────────────────────────────────────────────────────────────────────────
// Job Store
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Complete metadata structure stored on @JobController classes.
 *
 * Accessed via `Store.from(Class).get(MONQUE)`.
 */
export interface JobStore {
	/**
	 * Type identifier for the store.
	 * Always "controller" for JobController.
	 */
	type: 'controller';

	/**
	 * Optional namespace prefix for all jobs in this controller.
	 * When set, job names become "{namespace}.{name}".
	 */
	namespace?: string;

	/**
	 * Job method registrations from @Job decorators.
	 */
	jobs: JobMetadata[];

	/**
	 * Cron job registrations from @Cron decorators.
	 */
	cronJobs: CronMetadata[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the full job name by combining namespace and name.
 *
 * @param namespace - Optional namespace from @JobController
 * @param name - Job name from @Job or @Cron
 * @returns Full job name (e.g., "email.send" or just "send")
 */
export function buildJobName(namespace: string | undefined, name: string): string {
	return namespace ? `${namespace}.${name}` : name;
}
