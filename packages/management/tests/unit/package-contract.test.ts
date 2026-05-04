import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

interface PackageJson {
	name: string;
	private?: boolean;
	publishConfig?: {
		access?: string;
	};
	dependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
}

const FORBIDDEN_RUNTIME_PACKAGES = [
	'express',
	'connect',
	'@tsed/core',
	'@tsed/di',
	'@nestjs/common',
	'fastify',
	'hono',
	'@hono/node-server',
	'scalar',
	'mongodb',
] as const;

const TEST_DIRECTORY = fileURLToPath(new URL('.', import.meta.url));

describe('@monque/management package contract', () => {
	test('is publishable, peer-depends on core, and avoids framework coupling', async () => {
		const packageJson = await readPackageJson();
		const declaredPackages = {
			...packageJson.dependencies,
			...packageJson.peerDependencies,
			...packageJson.devDependencies,
		};
		const sourceFiles = await readSourceFiles(join(TEST_DIRECTORY, '../../src'));

		expect(packageJson.name).toBe('@monque/management');
		expect(packageJson.private).toBeUndefined();
		expect(packageJson.publishConfig?.access).toBe('public');
		expect(packageJson.peerDependencies).toMatchObject({
			'@monque/core': expect.any(String),
		});
		expect(packageJson.dependencies?.['@monque/core']).toBeUndefined();

		for (const packageName of FORBIDDEN_RUNTIME_PACKAGES) {
			expect(declaredPackages[packageName]).toBeUndefined();
			expect(sourceFiles).not.toContain(`from '${packageName}'`);
			expect(sourceFiles).not.toContain(`from "${packageName}"`);
		}
	});
});

async function readPackageJson(): Promise<PackageJson> {
	const raw = await readFile(join(TEST_DIRECTORY, '../../package.json'), 'utf8');
	const parsed = JSON.parse(raw) as PackageJson;

	return parsed;
}

async function readSourceFiles(directory: string): Promise<string> {
	const entries = await readdir(directory, { withFileTypes: true });
	const contents: string[] = [];

	for (const entry of entries) {
		const path = join(directory, entry.name);

		if (entry.isDirectory()) {
			contents.push(await readSourceFiles(path));
			continue;
		}

		if (entry.isFile() && entry.name.endsWith('.ts')) {
			contents.push(await readFile(path, 'utf8'));
		}
	}

	return contents.join('\n');
}
