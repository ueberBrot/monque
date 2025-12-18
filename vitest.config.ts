import { defineConfig } from 'vitest/config';

/**
 * Shared vitest configuration for the monorepo.
 * Package-level configs extend this with their own include/exclude paths.
 *
 * Usage:
 * - `bun test` - Run tests via turbo
 * - `bun test:ui` - Open Vitest UI in browser
 * - `bun test:coverage` - Run tests with coverage report
 */
export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		coverage: {
			enabled: true,
			provider: 'v8',
			reporter: ['text', 'json', 'html', 'lcov'],
			reportsDirectory: './coverage',
			exclude: [
				'**/node_modules/**',
				'**/dist/**',
				'**/*.d.ts',
				'**/tests/**',
				'**/*.config.ts',
				'**/*.config.js',
				'**/index.ts',
			],
			thresholds: {
				lines: 75,
				functions: 70,
				branches: 70,
				statements: 75,
			},
		},
		testTimeout: 30000,
		hookTimeout: 30000,
	},
});
