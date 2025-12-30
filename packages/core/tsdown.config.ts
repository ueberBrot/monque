import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: ['src/index.ts', 'src/testing/index.ts'],
	format: ['esm', 'cjs'],
	dts: true,
	clean: true,
	sourcemap: true,
	target: 'node22',
	outDir: 'dist',
	external: ['mongodb', 'fishery', '@faker-js/faker', '@testcontainers/mongodb'],
});
