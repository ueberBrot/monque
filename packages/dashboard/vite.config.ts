import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { devtools } from '@tanstack/devtools-vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const config = defineConfig({
	base: './',
	test: {
		fileParallelism: false,
	},
	resolve: {
		tsconfigPaths: true,
		alias: {
			'@monque/management/contract': fileURLToPath(
				new URL('../management/src/contract.ts', import.meta.url),
			),
		},
	},
	build: {
		manifest: true,
		outDir: 'dist/client',
		emptyOutDir: true,
	},
	plugins: [
		devtools({
			consolePiping: {
				enabled: true,
				levels: ['log', 'warn', 'error'],
			},
			enhancedLogs: {
				enabled: true,
			},
			eventBusConfig: {
				debug: false,
				enabled: true,
				port: 4206,
			},
			injectSource: {
				enabled: true,
				ignore: {
					files: [/.*\.test\.(ts|tsx)$/],
				},
			},
			logging: true,
			removeDevtoolsOnBuild: true,
		}),
		tailwindcss(),
		tanstackRouter({ target: 'react', autoCodeSplitting: true }),
		viteReact(),
	],
});

export default config;
