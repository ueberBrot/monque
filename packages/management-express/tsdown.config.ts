import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: ['src/index.ts'],
	format: ['esm', 'cjs'],
	dts: true,
	clean: true,
	sourcemap: true,
	target: 'node22',
	outDir: 'dist',
	deps: {
		neverBundle: ['@monque/core', '@monque/management', 'express', 'mongodb'],
	},
	publint: true,
	attw: true,
	unused: {
		enabled: true,
		ignore: ['@monque/core', 'mongodb'],
	},
});
