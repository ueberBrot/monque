import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import viteReact from '@vitejs/plugin-react';
import type { Connect } from 'vite';
import { defineConfig, loadEnv } from 'vite';

import { createMockManagementOpenApiHandler } from './src/mock/management-server.js';
import {
	type DashboardDevScenarioId,
	dashboardDevScenarioIds,
} from './src/mock/scenario-catalog.js';

function getScenarioIdFromHeader(
	headerValue: string | string[] | undefined,
): DashboardDevScenarioId {
	if (
		typeof headerValue === 'string' &&
		dashboardDevScenarioIds.includes(headerValue as DashboardDevScenarioId)
	) {
		return headerValue as DashboardDevScenarioId;
	}

	return 'pending-jobs';
}

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

const config = defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), '');
	const devMode = env['MONQUE_DASHBOARD_DEV_MODE'] ?? 'mock';
	const liveApiBaseUrl = env['MONQUE_DASHBOARD_DEV_LIVE_API_BASE_URL'];
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

					server.middlewares.use('/api', async (request, response, next) => {
						if (!request.url) {
							next();
							return;
						}

						const body = await readNodeRequestBody(request);
						const requestInit: RequestInit = {
							method: request.method ?? 'GET',
							headers: request.headers as HeadersInit,
						};

						if (body) {
							requestInit.body = new Blob([new Uint8Array(body)]);
						}

						const handlerResult = await mockHandler.handle(
							new Request(`http://127.0.0.1:3400${request.url}`, requestInit),
							{
								context: {
									scenarioId: getScenarioIdFromHeader(request.headers['x-monque-dev-scenario']),
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
		],
	};
});

export default config;
