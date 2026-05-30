import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

import * as contractExports from '@/contract.js';

type PackageJson = {
	exports?: Record<string, unknown>;
};

const EXPECTED_CONTRACT_SUBPATH_EXPORT = {
	import: {
		types: './dist/contract.d.mts',
		default: './dist/contract.mjs',
	},
	require: {
		types: './dist/contract.d.cts',
		default: './dist/contract.cjs',
	},
} as const;

const EXPECTED_CONTRACT_PACKAGE_JSON = {
	type: 'module',
	main: '../dist/contract.cjs',
	module: '../dist/contract.mjs',
	types: '../dist/contract.d.mts',
} as const;

const BROWSER_SAFE_RUNTIME_EXPORTS = [
	'managementContract',
	'JobDtoSchema',
	'JobListQueryDtoSchema',
	'JobStatsQueryDtoSchema',
	'QueueViewSummaryListDtoSchema',
	'SchedulerHealthDtoSchema',
] as const;

const SERVER_ONLY_RUNTIME_EXPORTS = [
	'createManagementSurface',
	'createManagementRouter',
	'generateManagementOpenApiDocument',
] as const;

const packageJson = JSON.parse(
	readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as PackageJson;

const contractPackageJson = JSON.parse(
	readFileSync(new URL('../../contract/package.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

describe('management contract subpath export', () => {
	test('publishes a browser-safe ./contract subpath with ESM, CJS, and types entrypoints', () => {
		expect(packageJson.exports?.['./contract']).toEqual(EXPECTED_CONTRACT_SUBPATH_EXPORT);
		expect(contractPackageJson).toEqual(EXPECTED_CONTRACT_PACKAGE_JSON);
	});

	test('exports the runtime contract and DTO schemas without server-only factories', () => {
		for (const exportName of BROWSER_SAFE_RUNTIME_EXPORTS) {
			expect(contractExports).toHaveProperty(exportName);
		}

		for (const exportName of SERVER_ONLY_RUNTIME_EXPORTS) {
			expect(contractExports).not.toHaveProperty(exportName);
		}
	});
});
