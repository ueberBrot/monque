import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		tsconfigPaths: true,
		alias: {
			'@monque/management/contract': fileURLToPath(
				new URL('../management/src/contract.ts', import.meta.url),
			),
		},
	},
	plugins: [react()],
	test: {
		fileParallelism: false,
		include: ['tests/unit/**/*.test.{ts,tsx}'],
		setupFiles: ['./tests/setup/browser.ts'],
	},
});
