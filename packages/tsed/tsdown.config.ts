import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: ['src/index.ts'],
	format: ['esm', 'cjs'],
	dts: true,
	clean: true,
	sourcemap: true,
	target: 'node22',
	outDir: 'dist',
	external: ['@tsed/core', '@tsed/di', '@tsed/schema', '@tsed/logger', '@monque/core', 'mongodb'],
});
