import { defineConfig, mergeConfig } from 'vitest/config';
import rootConfig from '../../vitest.config.ts';

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
