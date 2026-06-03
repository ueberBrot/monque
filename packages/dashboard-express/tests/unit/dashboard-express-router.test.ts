import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

describe('Dashboard Express Adapter', () => {
	let assetDirectory: string;
	let htmlEntrypointPath: string;

	beforeEach(async () => {
		const tempDirectory = await mkdtemp(join(tmpdir(), 'monque-dashboard-express-'));
		assetDirectory = tempDirectory;
		htmlEntrypointPath = join(tempDirectory, 'index.html');

		await mkdir(join(tempDirectory, 'assets'));
		await writeFile(
			htmlEntrypointPath,
			[
				'<!doctype html>',
				'<html lang="en">',
				'<head>',
				'  <meta charset="UTF-8" />',
				'  <script id="monque-dashboard-runtime-config">',
				'    window.__MONQUE_DASHBOARD_CONFIG__ = {',
				"      basePath: '/',",
				"      apiBaseUrl: '/',",
				'      pollingIntervalMs: 5000',
				'    };',
				'  </script>',
				'</head>',
				'<body>',
				'  <div id="app"></div>',
				'  <script type="module" src="./assets/index-abc12345.js"></script>',
				'</body>',
				'</html>',
			].join('\n'),
		);
		await writeFile(
			join(tempDirectory, 'assets', 'index-abc12345.js'),
			'console.log("dashboard");',
		);
	});

	afterEach(async () => {
		vi.resetModules();
		vi.restoreAllMocks();
		await rm(assetDirectory, { force: true, recursive: true });
	});

	test('serves SPA HTML with mount-aware runtime config injection', async () => {
		const app = await createDashboardApp({ pollingIntervalMs: 15_000 });

		const response = await request(app)
			.get('/dashboard/jobs')
			.expect(200)
			.expect('content-type', /html/);

		expect(response.text).toContain('"basePath":"/dashboard"');
		expect(response.text).toContain('"apiBaseUrl":"/management/api/v1"');
		expect(response.text).toContain('"pollingIntervalMs":15000');
		expect(response.headers['cache-control']).not.toContain('max-age=31536000');
	});

	test('serves hashed static assets with immutable long-cache headers', async () => {
		const app = await createDashboardApp();

		const response = await request(app)
			.get('/dashboard/assets/index-abc12345.js')
			.expect(200)
			.expect('content-type', /javascript/);

		expect(response.text).toBe('console.log("dashboard");');
		expect(response.headers['cache-control']).toContain('public');
		expect(response.headers['cache-control']).toContain('max-age=31536000');
		expect(response.headers['cache-control']).toContain('immutable');
	});

	test('does not mount or proxy management API routes', async () => {
		const app = await createDashboardApp();

		await request(app).get('/dashboard/api/v1/health').expect(404);
	});

	test('derives root base path and supports api base URL resolvers', async () => {
		const app = await createDashboardApp({
			apiBaseUrl: ({ req }) => req.get('x-api-base-url') ?? '/api/v1',
			mountPath: '/',
		});

		const response = await request(app)
			.get('/jobs')
			.set('x-api-base-url', '/ops/api/v1')
			.expect(200);

		expect(response.text).toContain('"basePath":"/"');
		expect(response.text).toContain('"apiBaseUrl":"/ops/api/v1"');
		expect(response.text).not.toContain('"pollingIntervalMs"');
	});

	test('forwards resolver errors and skips SPA fallback for non-GET requests', async () => {
		const app = await createDashboardApp({
			apiBaseUrl: () => {
				throw new Error('Resolver failed');
			},
		});

		app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
			res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
		});

		await request(app).get('/dashboard/jobs').expect(500).expect({ error: 'Resolver failed' });
		await request(app).post('/dashboard/jobs').expect(404);
	});

	async function createDashboardApp(
		options: {
			readonly apiBaseUrl?: string | ((context: { req: Request; res: Response }) => string);
			readonly mountPath?: string;
			readonly pollingIntervalMs?: number;
		} = {},
	): Promise<Express> {
		vi.doMock('@/dashboard-assets', () => ({
			getDashboardAssetDirectory: () => assetDirectory,
			getDashboardAssetMetadata: () => ({
				assetDirectory: 'client',
				htmlEntrypoint: 'index.html',
				manifestPath: '.vite/manifest.json',
				runtimeConfigGlobal: '__MONQUE_DASHBOARD_CONFIG__',
				runtimeConfigScriptId: 'monque-dashboard-runtime-config',
			}),
			getDashboardHtmlEntrypointPath: () => htmlEntrypointPath,
		}));

		const { createDashboardExpressRouter } = await import('@/index');

		const app = express();
		app.use(
			options.mountPath ?? '/dashboard',
			createDashboardExpressRouter({
				apiBaseUrl: options.apiBaseUrl ?? '/management/api/v1',
				...(options.pollingIntervalMs === undefined
					? {}
					: { pollingIntervalMs: options.pollingIntervalMs }),
			}),
		);

		return app;
	}
});
