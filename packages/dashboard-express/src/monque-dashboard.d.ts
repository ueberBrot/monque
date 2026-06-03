declare module '@monque/dashboard' {
	type DashboardAssetMetadata = {
		assetDirectory: 'client';
		htmlEntrypoint: 'index.html';
		manifestPath: '.vite/manifest.json';
		runtimeConfigGlobal: string;
		runtimeConfigScriptId: string;
	};

	export function getDashboardAssetDirectory(): string;
	export function getDashboardAssetMetadata(): DashboardAssetMetadata;
	export function getDashboardHtmlEntrypointPath(): string;
}
