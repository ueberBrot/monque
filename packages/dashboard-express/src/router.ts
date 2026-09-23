import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	type DashboardRuntimeConfig,
	getDashboardAssetDirectory,
	getDashboardAssetMetadata,
	getDashboardHtmlEntrypointPath,
	parseDashboardRuntimeConfig,
} from '@monque/dashboard';
import {
	type NextFunction,
	type Request,
	type Response,
	Router,
	static as serveStatic,
} from 'express';

import type { DashboardExpressApiBaseUrlValue, DashboardExpressRouterOptions } from './types.js';

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
	return parseDashboardRuntimeConfig({
		apiBaseUrl: await resolveApiBaseUrl(options.apiBaseUrl, req, res),
		basePath: req.baseUrl || '/',
		pollingIntervalMs: options.pollingIntervalMs,
	});
}

function injectRuntimeConfig(htmlTemplate: string, options: RuntimeConfigInjectionOptions): string {
	const assetBasePath = `${options.runtimeConfig.basePath.replace(/\/$/, '')}/assets/`
		.replaceAll('&', '&amp;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;');
	// Relative Vite assets otherwise resolve below a deep-link route (for example /jobs/:id).
	const mountAwareHtml = htmlTemplate.replace(
		/\b(src|href)=(['"])\.\/assets\//g,
		(_match, attribute: string, quote: string) => `${attribute}=${quote}${assetBasePath}`,
	);
	const runtimeConfigJson = JSON.stringify(options.runtimeConfig).replaceAll('<', '\\u003c');
	const runtimeConfigScript = [
		`<script id="${options.runtimeConfigScriptId}">`,
		`window.${options.runtimeConfigGlobal} = ${runtimeConfigJson};`,
		'</script>',
	].join('');

	return mountAwareHtml.replace(
		new RegExp(
			`<script\\s+id=["']${escapeRegularExpression(options.runtimeConfigScriptId)}["'][^>]*>[\\s\\S]*?<\\/script>`,
		),
		() => runtimeConfigScript,
	);
}

function shouldServeDashboardHtml(req: Request): boolean {
	if (req.method !== 'GET' && req.method !== 'HEAD') {
		return false;
	}

	if (
		req.path === '/api' ||
		req.path.startsWith('/api/') ||
		req.path === '/assets' ||
		req.path.startsWith('/assets/')
	) {
		return false;
	}

	if (
		req.path === '/index.html' ||
		req.path.startsWith('/queue-views/') ||
		req.path.startsWith('/jobs/')
	) {
		return true;
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
