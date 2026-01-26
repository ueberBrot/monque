import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: ['src/index.ts'],
	format: ['esm', 'cjs'],
	dts: true,
	clean: true,
	sourcemap: true,
	target: 'node22',
	outDir: 'dist',
	external: ['mongodb'],
	copy: ['LICENSE', 'README.md', 'CHANGELOG.md'],
	publint: true,
	attw: true,
	unused: true,
});
