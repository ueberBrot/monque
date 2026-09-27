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
		include: ['tests/**/*.test.ts'],
		globalSetup: ['./tests/integration/helpers/global-setup.ts'],
		fileParallelism: false,
		testTimeout: 30000,
		hookTimeout: 60000,
	},
});
