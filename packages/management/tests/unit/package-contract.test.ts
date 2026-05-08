import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import {
	BulkActionResultDtoSchema,
	CapabilitiesDtoSchema,
	DeleteJobDtoSchema,
	JobCursorPageDtoSchema,
	JobDtoSchema,
	JobSelectorDtoSchema,
	QueueStatsDtoSchema,
	QueueViewSummaryListDtoSchema,
	RescheduleJobRequestDtoSchema,
} from '@/index';

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

	test('exports the Zod-derived capabilities DTO schema', () => {
		expect(
			CapabilitiesDtoSchema.safeParse({
				readOnly: false,
				actions: {
					read: true,
					cancel: false,
					retry: false,
					reschedule: false,
					delete: false,
				},
			}).success,
		).toBe(true);
	});

	test('exports the Zod-derived read DTO schemas', () => {
		expect(
			JobDtoSchema.safeParse({
				id: '000000000000000000000000',
				name: 'send-email',
				status: 'completed',
				payload: { ok: true },
				nextRunAt: '2026-01-01T00:00:00.000Z',
				lockedAt: null,
				claimedBy: null,
				lastHeartbeat: null,
				failCount: 0,
				failureReason: null,
				createdAt: '2025-12-31T23:00:00.000Z',
				updatedAt: '2026-01-01T00:01:00.000Z',
			}).success,
		).toBe(true);
		expect(
			JobCursorPageDtoSchema.safeParse({
				jobs: [],
				cursor: null,
				hasNextPage: false,
				hasPreviousPage: false,
			}).success,
		).toBe(true);
		expect(
			QueueStatsDtoSchema.safeParse({
				pending: 1,
				processing: 2,
				completed: 3,
				failed: 4,
				cancelled: 5,
				total: 15,
			}).success,
		).toBe(true);
		expect(
			QueueViewSummaryListDtoSchema.safeParse({
				queueViews: [
					{
						name: 'send-email',
						hasPersistedJobs: true,
						hasRegisteredWorker: false,
						stats: {
							pending: 1,
							processing: 0,
							completed: 0,
							failed: 0,
							cancelled: 0,
							total: 1,
						},
						worker: null,
					},
				],
			}).success,
		).toBe(true);
	});

	test('exports the Zod-derived bulk action DTO schemas', () => {
		expect(
			JobSelectorDtoSchema.safeParse({
				name: 'send-email',
				status: ['pending'],
				olderThan: '2026-02-01T10:30:00.000Z',
				newerThan: '2026-01-01T00:00:00.000Z',
			}).success,
		).toBe(true);
		expect(
			BulkActionResultDtoSchema.safeParse({
				count: 1,
				errors: [{ jobId: 'job-1', error: 'still processing' }],
			}).success,
		).toBe(true);
	});

	test('exports the Zod-derived single Job action DTO schemas', () => {
		expect(
			RescheduleJobRequestDtoSchema.safeParse({
				nextRunAt: '2026-02-01T10:30:00.000Z',
			}).success,
		).toBe(true);
		expect(
			DeleteJobDtoSchema.safeParse({
				deleted: true,
			}).success,
		).toBe(true);
	});
});

async function readPackageJson(): Promise<PackageJson> {
	const raw = await readFile(join(TEST_DIRECTORY, '../../package.json'), 'utf8');
	const parsed = JSON.parse(raw) as PackageJson;

	return parsed;
}
