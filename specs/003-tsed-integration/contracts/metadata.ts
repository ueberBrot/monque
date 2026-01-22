/**
 * @monque/tsed - Metadata Contracts
 *
 * Internal metadata structures used by decorators and the module.
 * These are not part of the public API but define the data contract
 * between decorators and the module.
 */

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
export const MonqueTypes = {
	/** Provider type for @WorkerController decorated classes */
	WORKER_CONTROLLER: 'monque:worker-controller',
	/** Provider type for cron job handlers */
	CRON: 'monque:cron',
} as const;

export type MonqueTypesType = (typeof MonqueTypes)[keyof typeof MonqueTypes];

// ─────────────────────────────────────────────────────────────────────────────
// Worker Metadata
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Metadata for a single @Worker decorated method.
 */
export interface WorkerMetadata {
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
	 * Worker options forwarded to Monque.register().
	 */
	opts: {
		concurrency?: number;
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// Cron Metadata
// ─────────────────────────────────────────────────────────────────────────────

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
	opts: {
		name?: string;
		uniqueKey?: string;
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker Store
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Complete metadata structure stored on @WorkerController classes.
 *
 * Accessed via `Store.from(Class).get(MONQUE)`.
 */
export interface WorkerStore {
	/**
	 * Type identifier for the store.
	 * Always "controller" for WorkerController.
	 */
	type: 'controller';

	/**
	 * Optional namespace prefix for all jobs in this controller.
	 * When set, job names become "{namespace}.{name}".
	 */
	namespace?: string;

	/**
	 * Worker method registrations from @Worker decorators.
	 */
	workers: WorkerMetadata[];

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
 * @param namespace - Optional namespace from @WorkerController
 * @param name - Job name from @Worker or @Cron
 * @returns Full job name (e.g., "email.send" or just "send")
 */
export function buildJobName(namespace: string | undefined, name: string): string {
	return namespace ? `${namespace}.${name}` : name;
}
