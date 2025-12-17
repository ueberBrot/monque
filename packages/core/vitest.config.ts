import { defineConfig, mergeConfig } from 'vitest/config';
import rootConfig from '../../vitest.config.js';

export default mergeConfig(
	rootConfig,
	defineConfig({
		test: {
			include: ['tests/**/*.test.ts'],
			coverage: {
				include: ['src/**/*.ts'],
			},
			// Global setup for MongoDB Testcontainers (returns teardown function)
			globalSetup: ['./tests/setup/global-setup.ts'],
			// Increase timeout for integration tests (container startup can be slow)
			testTimeout: 30000,
			hookTimeout: 60000,
		},
	}),
);
