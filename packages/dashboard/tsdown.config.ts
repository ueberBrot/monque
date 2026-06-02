import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsdown';

const dashboardPackageDirectory = dirname(fileURLToPath(import.meta.url));

let dashboardClientBuild: Promise<void> | undefined;

function buildDashboardClient(): Promise<void> {
	dashboardClientBuild ??= new Promise((resolve, reject) => {
		const child = spawn('bun', ['run', 'build:client'], {
			cwd: dashboardPackageDirectory,
			stdio: 'inherit',
		});

		child.on('error', reject);
		child.on('exit', (code, signal) => {
			if (code === 0) {
				resolve();
				return;
			}

			reject(new Error(`Dashboard client build failed with code ${code} and signal ${signal}.`));
		});
	});
	return dashboardClientBuild;
}

export default defineConfig({
	entry: ['src/index.ts'],
	format: ['esm', 'cjs'],
	dts: true,
	clean: false,
	sourcemap: true,
	target: 'node22',
	outDir: 'dist',
	deps: {
		neverBundle: ['@monque/management'],
	},
	hooks: {
		'build:done': async () => {
			await buildDashboardClient();
		},
	},
	publint: true,
	attw: true,
});
