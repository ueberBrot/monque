import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import {
	BulkActionResultDtoSchema,
	CapabilitiesDtoSchema,
	createManagementRouter,
	createManagementSurface,
	DeleteJobDtoSchema,
	generateManagementOpenApiDocument,
	JobCursorPageDtoSchema,
	JobDtoSchema,
	JobSelectorDtoSchema,
	managementContract,
	QueueStatsDtoSchema,
	QueueViewSummaryListDtoSchema,
	RescheduleJobRequestDtoSchema,
} from '@/index';

interface PackageJson {
	name: string;
	private?: boolean;
	keywords?: string[];
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
	'zod',
] as const;

const FORBIDDEN_RUNTIME_DEPENDENCIES = [
	'@orpc/client',
	'@orpc/openapi-client',
	'@scalar/api-reference',
	'@sinclair/typebox',
	'@types/express',
	'@types/koa',
	'@types/node',
	'express',
	'fastify',
	'hono',
	'koa',
	'openapi3-ts',
] as const;

const TEST_DIRECTORY = fileURLToPath(new URL('.', import.meta.url));
const PACKAGE_DIRECTORY = join(TEST_DIRECTORY, '../..');

const FORBIDDEN_SOURCE_PATTERNS = [
	'@sinclair/typebox',
	'openapi3-ts',
	'ManagementRequest',
	'ManagementResponse',
	'ManagementQueryValue',
	'MANAGEMENT_ROUTE_MAP',
	'normalizeManagementRequest',
] as const;

const FORBIDDEN_SOURCE_PATHS = [
	'src/dtos',
	'src/http',
	'src/openapi',
	'src/request',
	'src/routes',
	'src/validation',
] as const;

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
		expect(packageJson.keywords).toEqual(expect.arrayContaining(['orpc', 'zod', 'openapi']));
		expect(packageJson.keywords).not.toContain('typebox');
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
		for (const dependency of FORBIDDEN_RUNTIME_DEPENDENCIES) {
			expect(packageJson.dependencies?.[dependency]).toBeUndefined();
		}
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

	test('exports the oRPC server-side surface APIs', () => {
		expect(createManagementSurface).toEqual(expect.any(Function));
		expect(createManagementRouter).toEqual(expect.any(Function));
		expect(generateManagementOpenApiDocument).toEqual(expect.any(Function));
		expect(managementContract).toEqual(
			expect.objectContaining({
				health: expect.any(Object),
				capabilities: expect.any(Object),
				jobs: expect.any(Object),
				cancelJobs: expect.any(Object),
			}),
		);
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

	test('does not ship the old custom route/request/OpenAPI stack', async () => {
		const sourceFiles = await listPackageFiles(join(PACKAGE_DIRECTORY, 'src'));
		const sourcePaths = sourceFiles.map((filePath) => filePath.slice(PACKAGE_DIRECTORY.length + 1));

		for (const forbiddenPath of FORBIDDEN_SOURCE_PATHS) {
			expect(sourcePaths.some((filePath) => filePath.startsWith(forbiddenPath))).toBe(false);
		}

		const sourceText = await Promise.all(sourceFiles.map((filePath) => readFile(filePath, 'utf8')));

		for (const forbiddenPattern of FORBIDDEN_SOURCE_PATTERNS) {
			expect(sourceText.some((text) => text.includes(forbiddenPattern))).toBe(false);
		}
	});

	test('documents the oRPC server-only surface instead of the old route map', async () => {
		const readme = await readFile(join(PACKAGE_DIRECTORY, 'README.md'), 'utf8');

		expect(readme).toContain('oRPC');
		expect(readme).toContain('server-only');
		expect(readme).toContain('generateManagementOpenApiDocument');
		expect(readme).not.toContain('TypeBox');
		expect(readme).not.toContain('route map');
		expect(readme).not.toContain('ManagementRequest');
		expect(readme).not.toContain('ManagementResponse');
	});
});

async function readPackageJson(): Promise<PackageJson> {
	const raw = await readFile(join(PACKAGE_DIRECTORY, 'package.json'), 'utf8');
	const parsed = JSON.parse(raw) as PackageJson;

	return parsed;
}

async function listPackageFiles(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = await Promise.all(
		entries.map((entry) => {
			const entryPath = join(directory, entry.name);

			if (entry.isDirectory()) {
				return listPackageFiles(entryPath);
			}

			return [entryPath];
		}),
	);

	return files.flat();
}
