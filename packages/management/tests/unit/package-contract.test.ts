import { readFile } from 'node:fs/promises';
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

const EXPECTED_RUNTIME_DEPENDENCIES = [
	'@orpc/contract',
	'@orpc/openapi',
	'@orpc/server',
	'@orpc/zod',
	'@sinclair/typebox',
	'openapi3-ts',
	'zod',
] as const;

const TEST_DIRECTORY = fileURLToPath(new URL('.', import.meta.url));

describe('@monque/management package contract', () => {
	test('is publishable, peer-depends on core and mongodb, and avoids framework coupling', async () => {
		const packageJson = await readPackageJson();

		expect(packageJson.name).toBe('@monque/management');
		expect(packageJson.private).toBeUndefined();
		expect(packageJson.publishConfig?.access).toBe('public');
		expect(packageJson.peerDependencies).toMatchObject({
			'@monque/core': expect.any(String),
			mongodb: expect.any(String),
		});
		expect(packageJson.dependencies?.['@monque/core']).toBeUndefined();
		expect(packageJson.dependencies?.['mongodb']).toBeUndefined();
		expect(packageJson.dependencies).toMatchObject({
			'@orpc/contract': expect.any(String),
			'@orpc/openapi': expect.any(String),
			'@orpc/server': expect.any(String),
			'@orpc/zod': expect.any(String),
			zod: expect.any(String),
		});
		expect(Object.keys(packageJson.dependencies ?? {}).sort()).toEqual([
			...EXPECTED_RUNTIME_DEPENDENCIES,
		]);
	});
});

async function readPackageJson(): Promise<PackageJson> {
	const raw = await readFile(join(TEST_DIRECTORY, '../../package.json'), 'utf8');
	const parsed = JSON.parse(raw) as PackageJson;

	return parsed;
}
