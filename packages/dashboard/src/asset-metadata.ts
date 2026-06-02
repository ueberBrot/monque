import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DASHBOARD_RUNTIME_CONFIG_GLOBAL = '__MONQUE_DASHBOARD_CONFIG__';
const DASHBOARD_RUNTIME_CONFIG_SCRIPT_ID = 'monque-dashboard-runtime-config';

type DashboardAssetMetadata = {
	assetDirectory: 'client';
	htmlEntrypoint: 'index.html';
	manifestPath: '.vite/manifest.json';
	runtimeConfigGlobal: typeof DASHBOARD_RUNTIME_CONFIG_GLOBAL;
	runtimeConfigScriptId: typeof DASHBOARD_RUNTIME_CONFIG_SCRIPT_ID;
};

const DashboardAssetMetadata: DashboardAssetMetadata = {
	assetDirectory: 'client',
	htmlEntrypoint: 'index.html',
	manifestPath: '.vite/manifest.json',
	runtimeConfigGlobal: DASHBOARD_RUNTIME_CONFIG_GLOBAL,
	runtimeConfigScriptId: DASHBOARD_RUNTIME_CONFIG_SCRIPT_ID,
};

const dashboardPackageDistDirectory = dirname(fileURLToPath(import.meta.url));

function getDashboardAssetMetadata(): DashboardAssetMetadata {
	return DashboardAssetMetadata;
}

function getDashboardAssetDirectory(): string {
	return join(dashboardPackageDistDirectory, DashboardAssetMetadata.assetDirectory);
}

function getDashboardHtmlEntrypointPath(): string {
	return join(getDashboardAssetDirectory(), DashboardAssetMetadata.htmlEntrypoint);
}

function getDashboardManifestPath(): string {
	return join(getDashboardAssetDirectory(), DashboardAssetMetadata.manifestPath);
}

export {
	DASHBOARD_RUNTIME_CONFIG_GLOBAL,
	DASHBOARD_RUNTIME_CONFIG_SCRIPT_ID,
	type DashboardAssetMetadata,
	getDashboardAssetDirectory,
	getDashboardAssetMetadata,
	getDashboardHtmlEntrypointPath,
	getDashboardManifestPath,
};
