/**
 * Provider type constants for DI scanning.
 *
 * These constants are used to categorize providers registered with Ts.ED's
 * dependency injection container, enabling MonqueModule to discover and
 * register workers automatically.
 *
 * Note: Using string constants with `as const` instead of enums per
 * Constitution guidelines.
 */
export const ProviderTypes = {
	/** Provider type for @WorkerController decorated classes */
	WORKER_CONTROLLER: 'monque:worker-controller',
	/** Provider type for cron job handlers */
	CRON: 'monque:cron',
} as const;

/**
 * Union type of all provider type values.
 */
export type ProviderType = (typeof ProviderTypes)[keyof typeof ProviderTypes];
