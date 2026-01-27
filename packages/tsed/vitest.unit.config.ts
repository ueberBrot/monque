import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		alias: {
			'@': fileURLToPath(new URL('./src', import.meta.url)),
			'@tests': fileURLToPath(new URL('./tests', import.meta.url)),
		},
	},
	test: {
		globals: true,
		environment: 'node',
		include: ['tests/unit/**/*.test.ts'],
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
				'src/**/types.ts',
			],
			thresholds: {
				lines: 85,
				functions: 85,
				branches: 75,
				statements: 85,
			},
		},
		testTimeout: 5000,
		hookTimeout: 10000,
	},
});
