import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import viteReact from '@vitejs/plugin-react';
import type { Connect } from 'vite';
import { defineConfig, loadEnv } from 'vite';

import { createLocalDbManagementServer } from './src/local-db/management-server.js';
import { createMockManagementOpenApiHandler } from './src/mock/management-server.js';
import {
	type DashboardDevScenarioId,
	isDashboardDevScenarioId,
} from './src/mock/scenario-catalog.js';

const DEFAULT_SCENARIO_ID = 'pending-jobs';
const MOCK_API_ORIGIN = 'http://dashboard-dev.local';
const MOCK_API_MOUNT_PATH = '/api';

async function readNodeRequestBody(request: Connect.IncomingMessage): Promise<Buffer | undefined> {
	if (request.method === 'GET' || request.method === 'HEAD') {
		return undefined;
	}

	const chunks: Uint8Array[] = [];

	for await (const chunk of request) {
		chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
	}

	if (chunks.length === 0) {
		return undefined;
	}

	return Buffer.concat(chunks);
}

function createHeadersFromNodeRequest(request: Connect.IncomingMessage): Headers {
	const headers = new Headers();

	for (const [name, value] of Object.entries(request.headers)) {
		if (typeof value === 'undefined') {
			continue;
		}

		if (Array.isArray(value)) {
			for (const item of value) {
				headers.append(name, item);
			}
			continue;
		}

		headers.set(name, value);
	}

	return headers;
}

function getScenarioIdFromRequest(request: Connect.IncomingMessage): DashboardDevScenarioId {
	const headerValue = request.headers['x-monque-dev-scenario'];
	const scenarioId = Array.isArray(headerValue) ? headerValue[0] : headerValue;

	return isDashboardDevScenarioId(scenarioId) ? scenarioId : DEFAULT_SCENARIO_ID;
}

function createMockManagementRequestUrl(requestUrl: string): string {
	const path = requestUrl.startsWith('/') ? requestUrl : `/${requestUrl}`;

	return `${MOCK_API_ORIGIN}${MOCK_API_MOUNT_PATH}${path}`;
}

const config = defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), '');
	const devMode = env['MONQUE_DASHBOARD_DEV_MODE'] ?? 'mock';
	const liveApiBaseUrl = env['MONQUE_DASHBOARD_DEV_LIVE_API_BASE_URL'];
	const localDbMongoUri = env['MONQUE_DASHBOARD_DEV_MONGO_URI'];
	const localDbDatabaseName = env['MONQUE_DASHBOARD_DEV_DATABASE_NAME'];
	const mockHandler = createMockManagementOpenApiHandler();

	return {
		resolve: {
			alias: {
				'@': fileURLToPath(new URL('../../packages/dashboard/src', import.meta.url)),
				'@dashboard-dev': fileURLToPath(new URL('./src', import.meta.url)),
				'@monque/management/contract': fileURLToPath(
					new URL('../../packages/management/src/contract.ts', import.meta.url),
				),
			},
		},
		build: {
			outDir: 'dist',
			emptyOutDir: true,
		},
		server:
			devMode === 'live' && liveApiBaseUrl
				? {
						proxy: {
							'/api': {
								changeOrigin: true,
								target: liveApiBaseUrl,
							},
						},
					}
				: {},
		plugins: [
			tailwindcss(),
			viteReact(),
			{
				name: 'monque-dashboard-dev-mock-api',
				configureServer(server) {
					if (devMode !== 'mock') {
						return;
					}

					server.middlewares.use(MOCK_API_MOUNT_PATH, async (request, response, next) => {
						if (!request.url) {
							next();
							return;
						}

						const body = await readNodeRequestBody(request);
						const requestInit: RequestInit = {
							method: request.method ?? 'GET',
							headers: createHeadersFromNodeRequest(request),
						};

						if (body) {
							requestInit.body = new Blob([new Uint8Array(body)]);
						}

						const handlerResult = await mockHandler.handle(
							new Request(createMockManagementRequestUrl(request.url), requestInit),
							{
								context: {
									scenarioId: getScenarioIdFromRequest(request),
								},
							},
						);

						if (!handlerResult.matched) {
							next();
							return;
						}

						response.statusCode = handlerResult.response.status;
						handlerResult.response.headers.forEach((value: string, key: string) => {
							response.setHeader(key, value);
						});
						const responseBody = Buffer.from(await handlerResult.response.arrayBuffer());
						response.end(responseBody);
					});
				},
			},
			{
				name: 'monque-dashboard-dev-local-db-api',
				configureServer(server) {
					if (devMode !== 'db') {
						return;
					}

					const localDbServer = createLocalDbManagementServer({
						...(localDbMongoUri ? { mongoUri: localDbMongoUri } : {}),
						...(localDbDatabaseName ? { databaseName: localDbDatabaseName } : {}),
					});

					server.middlewares.use(MOCK_API_MOUNT_PATH, localDbServer.middleware);
					server.httpServer?.once('close', () => {
						void localDbServer.close();
					});
				},
			},
		],
	};
});

export default config;
