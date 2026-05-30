import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsdown';

const packageJson = JSON.parse(
	readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };

export default defineConfig({
	entry: ['src/index.ts', 'src/contract.ts'],
	format: ['esm', 'cjs'],
	dts: true,
	clean: true,
	sourcemap: true,
	target: 'node22',
	outDir: 'dist',
	deps: {
		neverBundle: ['@monque/core'],
	},
	define: {
		__MONQUE_MANAGEMENT_PACKAGE_VERSION__: JSON.stringify(packageJson.version),
	},
	copy: ['LICENSE', 'README.md', 'CHANGELOG.md'],
	publint: true,
	attw: true,
	unused: {
		enabled: true,
		ignore: ['@monque/core'],
	},
});
