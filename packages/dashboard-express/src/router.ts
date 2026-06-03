import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	type NextFunction,
	type Request,
	type Response,
	Router,
	static as serveStatic,
} from 'express';

import {
	getDashboardAssetDirectory,
	getDashboardAssetMetadata,
	getDashboardHtmlEntrypointPath,
} from './dashboard-assets.js';
import type { DashboardExpressApiBaseUrlValue, DashboardExpressRouterOptions } from './types.js';

type DashboardRuntimeConfig = {
	readonly apiBaseUrl: string;
	readonly basePath: string;
	readonly pollingIntervalMs?: number;
};

type RuntimeConfigInjectionOptions = {
	readonly runtimeConfig: DashboardRuntimeConfig;
	readonly runtimeConfigGlobal: string;
	readonly runtimeConfigScriptId: string;
};

export function createDashboardExpressRouter(options: DashboardExpressRouterOptions): Router {
	const router = Router();
	const assetDirectory = getDashboardAssetDirectory();
	const htmlTemplate = readFileSync(getDashboardHtmlEntrypointPath(), 'utf8');
	const { runtimeConfigGlobal, runtimeConfigScriptId } = getDashboardAssetMetadata();

	router.use(
		'/assets',
		serveStatic(join(assetDirectory, 'assets'), {
			immutable: true,
			index: false,
			maxAge: '1y',
		}),
	);
	router.use(
		serveStatic(assetDirectory, {
			index: false,
		}),
	);

	router.use(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
		if (!shouldServeDashboardHtml(req)) {
			next();
			return;
		}

		try {
			const runtimeConfig = await createRuntimeConfig(options, req, res);

			res.setHeader('Cache-Control', 'no-store');
			res.type('html').send(
				injectRuntimeConfig(htmlTemplate, {
					runtimeConfig,
					runtimeConfigGlobal,
					runtimeConfigScriptId,
				}),
			);
		} catch (error) {
			next(error);
		}
	});

	return router;
}

async function createRuntimeConfig(
	options: DashboardExpressRouterOptions,
	req: Request,
	res: Response,
): Promise<DashboardRuntimeConfig> {
	const runtimeConfig = {
		apiBaseUrl: await resolveApiBaseUrl(options.apiBaseUrl, req, res),
		basePath: normalizeBasePath(req.baseUrl),
	};

	if (options.pollingIntervalMs === undefined) {
		return runtimeConfig;
	}

	return {
		...runtimeConfig,
		pollingIntervalMs: options.pollingIntervalMs,
	};
}

function injectRuntimeConfig(htmlTemplate: string, options: RuntimeConfigInjectionOptions): string {
	const runtimeConfigJson = JSON.stringify(options.runtimeConfig).replaceAll('<', '\\u003c');
	const runtimeConfigScript = [
		`<script id="${options.runtimeConfigScriptId}">`,
		`window.${options.runtimeConfigGlobal} = ${runtimeConfigJson};`,
		'</script>',
	].join('');

	return htmlTemplate.replace(
		new RegExp(
			`<script\\s+id=["']${escapeRegularExpression(options.runtimeConfigScriptId)}["'][^>]*>[\\s\\S]*?<\\/script>`,
		),
		runtimeConfigScript,
	);
}

function normalizeBasePath(basePath: string): string {
	if (!basePath || basePath === '/') {
		return '/';
	}

	return basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
}

function shouldServeDashboardHtml(req: Request): boolean {
	if (req.method !== 'GET' && req.method !== 'HEAD') {
		return false;
	}

	if (req.path.startsWith('/api/')) {
		return false;
	}

	return !req.path.includes('.');
}

async function resolveApiBaseUrl(
	apiBaseUrl: DashboardExpressApiBaseUrlValue,
	req: Request,
	res: Response,
): Promise<string> {
	if (typeof apiBaseUrl === 'string') {
		return apiBaseUrl;
	}

	return apiBaseUrl({ req, res });
}

function escapeRegularExpression(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
