/**
 * @monque/tsed - Configuration
 *
 * Defines the configuration interface and TsED module augmentation.
 */

import type { MonqueTsedConfig } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// TsED Module Augmentation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Augment TsED's Configuration interface to include monque settings.
 *
 * This allows type-safe configuration via @Configuration decorator.
 */
declare global {
	namespace TsED {
		interface Configuration {
			/**
			 * Monque job queue configuration.
			 */
			monque?: MonqueTsedConfig;
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate that exactly one database resolution strategy is provided.
 *
 * @param config - The configuration to validate.
 * @throws Error if zero or multiple strategies are provided.
 *
 * @example
 * ```typescript
 * validateDatabaseConfig({ db: mongoDb }); // OK
 * validateDatabaseConfig({}); // throws
 * validateDatabaseConfig({ db: mongoDb, dbFactory: fn }); // throws
 * ```
 */
export function validateDatabaseConfig(config: MonqueTsedConfig): void {
	const strategies = [config.db, config.dbFactory, config.dbToken].filter(Boolean);

	if (strategies.length === 0) {
		throw new Error(
			"MonqueTsedConfig requires exactly one of 'db', 'dbFactory', or 'dbToken' to be set",
		);
	}

	if (strategies.length > 1) {
		throw new Error(
			"MonqueTsedConfig accepts only one of 'db', 'dbFactory', or 'dbToken' - multiple were provided",
		);
	}
}
