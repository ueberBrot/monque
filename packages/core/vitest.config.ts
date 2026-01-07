import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		alias: {
			'@': fileURLToPath(new URL('./src', import.meta.url)),
			'@tests': fileURLToPath(new URL('./tests', import.meta.url)),
			'@test-utils': fileURLToPath(new URL('./tests/setup', import.meta.url)),
		},
	},
	test: {
		globals: true,
		environment: 'node',
		include: ['tests/**/*.test.ts'],
		coverage: {
			enabled: true,
			provider: 'v8',
			reporter: ['text', 'json', 'json-summary', 'html', 'lcov'],
			reportsDirectory: './coverage',
			include: ['src/**/*.ts'],
			exclude: [
				'**/node_modules/**',
				'**/dist/**',
				'**/*.d.ts',
				'**/tests/**',
				'**/*.config.ts',
				'**/*.config.js',
				'**/index.ts',
				// Type-only files with no runtime code
				'src/**/types.ts',
				'src/events/types.ts',
				'src/workers/types.ts',
				'src/scheduler/types.ts',
			],
			thresholds: {
				lines: 85,
				functions: 85,
				branches: 75,
				statements: 85,
			},
		},
		// Global setup for MongoDB Testcontainers (returns teardown function)
		globalSetup: ['./tests/setup/global-setup.ts'],
		// Seed faker for deterministic tests
		setupFiles: ['./tests/setup/seed.ts'],
		// Increase timeout for integration tests (container startup can be slow)
		testTimeout: 30000,
		hookTimeout: 60000,
	},
});
