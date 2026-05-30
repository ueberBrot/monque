import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

import * as contractExports from '@/contract.js';

type PackageJson = {
	exports?: Record<
		string,
		{
			import?: { types?: string; default?: string };
			require?: { types?: string; default?: string };
		}
	>;
};

const packageJson = JSON.parse(
	readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as PackageJson;

describe('management contract subpath export', () => {
	test('publishes a browser-safe ./contract subpath with ESM, CJS, and types entrypoints', () => {
		expect(packageJson.exports?.['./contract']).toEqual({
			import: {
				types: './dist/contract.d.mts',
				default: './dist/contract.mjs',
			},
			require: {
				types: './dist/contract.d.cts',
				default: './dist/contract.cjs',
			},
		});
	});

	test('exports the runtime contract and DTO schemas without server-only factories', () => {
		expect(contractExports).toHaveProperty('managementContract');
		expect(contractExports).toHaveProperty('JobDtoSchema');
		expect(contractExports).toHaveProperty('JobListQueryDtoSchema');
		expect(contractExports).toHaveProperty('JobStatsQueryDtoSchema');
		expect(contractExports).toHaveProperty('QueueViewSummaryListDtoSchema');
		expect(contractExports).toHaveProperty('SchedulerHealthDtoSchema');
		expect(contractExports).not.toHaveProperty('createManagementSurface');
		expect(contractExports).not.toHaveProperty('createManagementRouter');
		expect(contractExports).not.toHaveProperty('generateManagementOpenApiDocument');
	});
});
