import { fileURLToPath } from 'node:url';
import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import viteReact, { reactCompilerPreset } from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

import { createLocalDbManagementServer } from './src/local-db/management-server.js';
import { createManagementMiddleware, MANAGEMENT_MOUNT_PATH } from './src/management-middleware.js';
import { createMockManagementOpenApiHandler } from './src/mock/management-server.js';
import { isDashboardDevScenarioId } from './src/mock/scenario-catalog.js';

const DEFAULT_SCENARIO_ID = 'pending-jobs';

const config = defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), '');
	const devMode = env['MONQUE_DASHBOARD_DEV_MODE'] ?? 'mock';
	const liveApiBaseUrl = env['MONQUE_DASHBOARD_DEV_LIVE_API_BASE_URL'];
	const localDbMongoUri = env['MONQUE_DASHBOARD_DEV_MONGO_URI'];
	const localDbDatabaseName = env['MONQUE_DASHBOARD_DEV_DATABASE_NAME'];
	const mockHandler = createMockManagementOpenApiHandler();
	let localDbServer: ReturnType<typeof createLocalDbManagementServer> | undefined;

	return {
		define: {
			'import.meta.env.MONQUE_DASHBOARD_DEV_MODE': JSON.stringify(devMode),
			'import.meta.env.MONQUE_DASHBOARD_DEV_SCENARIO': JSON.stringify(
				env['MONQUE_DASHBOARD_DEV_SCENARIO'] ?? DEFAULT_SCENARIO_ID,
			),
			'import.meta.env.MONQUE_DASHBOARD_DEV_LIVE_API_BASE_URL': JSON.stringify(
				liveApiBaseUrl ?? '',
			),
		},
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
						port: 3400,
						proxy: {
							'/api': {
								changeOrigin: true,
								target: liveApiBaseUrl,
							},
						},
					}
				: { port: 3400 },
		plugins: [
			tailwindcss(),
			viteReact(),
			babel({ presets: [reactCompilerPreset({ target: '19' })] }),
			{
				name: 'monque-dashboard-dev-mock-api',
				configureServer(server) {
					if (devMode !== 'mock') {
						return;
					}

					server.middlewares.use(
						MANAGEMENT_MOUNT_PATH,
						createManagementMiddleware(async (request) => {
							const scenarioHeader = request.headers.get('x-monque-dev-scenario');
							const scenarioId = isDashboardDevScenarioId(scenarioHeader)
								? scenarioHeader
								: DEFAULT_SCENARIO_ID;
							const result = await mockHandler.handle(request, { context: { scenarioId } });
							return result.matched ? result.response : undefined;
						}),
					);
				},
			},
			{
				name: 'monque-dashboard-dev-local-db-api',
				configureServer(server) {
					if (devMode !== 'db') {
						return;
					}

					localDbServer = createLocalDbManagementServer({
						...(localDbMongoUri ? { mongoUri: localDbMongoUri } : {}),
						...(localDbDatabaseName ? { databaseName: localDbDatabaseName } : {}),
					});

					server.middlewares.use(MANAGEMENT_MOUNT_PATH, localDbServer.middleware);
					void localDbServer.start().catch((error: unknown) => {
						server.config.logger.error(error instanceof Error ? error.message : String(error));
					});
				},
				async closeBundle() {
					await localDbServer?.close();
				},
			},
		],
	};
});

export default config;
