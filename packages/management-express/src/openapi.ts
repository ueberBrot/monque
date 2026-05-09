import { generateManagementOpenApiDocument } from '@monque/management';
import type { NextFunction, Request, Response, Router } from 'express';

import type { ManagementExpressOpenApiOptions } from './types.js';

type ManagementExpressOpenApiDocument = Awaited<
	ReturnType<typeof generateManagementOpenApiDocument>
>;

export function mountOpenApiRoute(
	router: Router,
	options: false | ManagementExpressOpenApiOptions | undefined,
): void {
	const openApiOptions = normalizeOpenApiOptions(options);

	if (openApiOptions === null) {
		return;
	}

	router.get(
		openApiOptions.path,
		async (req: Request, res: Response, next: NextFunction): Promise<void> => {
			try {
				res.json(await createOpenApiDocument(req, res, openApiOptions));
			} catch (error) {
				next(error);
			}
		},
	);
}

function normalizeOpenApiOptions(
	options: false | ManagementExpressOpenApiOptions | undefined,
): Required<ManagementExpressOpenApiOptions> | null {
	if (options === false) {
		return null;
	}

	return {
		path: normalizeOpenApiPath(options?.path),
		serverUrl: options?.serverUrl ?? (({ req }) => normalizeServerUrl(req.baseUrl)),
	};
}

async function createOpenApiDocument(
	req: Request,
	res: Response,
	options: Required<ManagementExpressOpenApiOptions>,
): Promise<ManagementExpressOpenApiDocument> {
	// The management package caches the canonical document; clone before adding mount metadata.
	const document = structuredClone(await generateManagementOpenApiDocument());

	document.servers = [{ url: normalizeServerUrl(await resolveServerUrl(req, res, options)) }];

	return document;
}

function normalizeOpenApiPath(path: string | undefined): string {
	if (path === undefined) {
		return '/openapi.json';
	}

	return path.startsWith('/') ? path : `/${path}`;
}

function normalizeServerUrl(serverUrl: string): string {
	return serverUrl === '' ? '/' : serverUrl;
}

async function resolveServerUrl(
	req: Request,
	res: Response,
	options: Required<ManagementExpressOpenApiOptions>,
): Promise<string> {
	if (typeof options.serverUrl === 'string') {
		return options.serverUrl;
	}

	return options.serverUrl({ req, res });
}
