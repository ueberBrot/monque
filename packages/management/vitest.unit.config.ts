import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		alias: {
			'@monque/management/contract': fileURLToPath(new URL('./src/contract.ts', import.meta.url)),
			'@': fileURLToPath(new URL('./src', import.meta.url)),
			'@tests': fileURLToPath(new URL('./tests', import.meta.url)),
		},
	},
	test: {
		environment: 'node',
		include: ['tests/unit/**/*.test.ts'],
		testTimeout: 5000,
		hookTimeout: 10000,
	},
});
