import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		include: ['packages/*/tests/**/*.test.ts'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
			include: ['packages/*/src/**/*.ts'],
			exclude: ['**/node_modules/**', '**/dist/**', '**/*.d.ts'],
			thresholds: {
				lines: 100,
				functions: 100,
				branches: 100,
				statements: 100,
			},
		},
		testTimeout: 30000,
		hookTimeout: 30000,
	},
});
