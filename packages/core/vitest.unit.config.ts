import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vitest/config';

import rootConfig from '../../vitest.config.ts';

export default mergeConfig(
	rootConfig,
	defineConfig({
		resolve: {
			alias: {
				'@': fileURLToPath(new URL('./src', import.meta.url)),
				'@tests': fileURLToPath(new URL('./tests', import.meta.url)),
				'@test-utils': fileURLToPath(new URL('./tests/setup', import.meta.url)),
			},
		},
		test: {
			include: ['tests/unit/**/*.test.ts'],
			coverage: {
				include: ['src/**/*.ts'],
			},
			// Unit tests don't need MongoDB
			setupFiles: ['./tests/setup/seed.ts'],
			// Shorter timeouts for unit tests
			testTimeout: 5000,
			hookTimeout: 10000,
		},
	}),
);
