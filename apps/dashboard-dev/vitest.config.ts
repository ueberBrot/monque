import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		alias: {
			'@': fileURLToPath(new URL('../../packages/dashboard/src', import.meta.url)),
			'@dashboard-dev': fileURLToPath(new URL('./src', import.meta.url)),
			'@monque/management/contract': fileURLToPath(
				new URL('../../packages/management/src/contract.ts', import.meta.url),
			),
		},
	},
	test: {
		environment: 'node',
		include: ['tests/unit/**/*.test.ts'],
	},
});
