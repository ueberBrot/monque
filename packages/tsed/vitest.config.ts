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
			// Allow empty test suites until tests are added
			passWithNoTests: true,
		},
	}),
);
