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
				'@test-utils': fileURLToPath(new URL('./tests/test-utils', import.meta.url)),
			},
		},
		test: {
			include: ['tests/**/*.test.ts'],
			coverage: {
				include: ['src/**/*.ts'],
			},
			// Allow empty test suites until tests are added
			passWithNoTests: true,
		},
	}),
);
