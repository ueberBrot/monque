import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
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
	plugins: [react()],
	test: {
		environment: 'node',
		maxWorkers: 2,
		include: ['tests/unit/**/*.test.{ts,tsx}'],
		setupFiles: ['../../packages/dashboard/tests/setup/browser.ts'],
	},
});
