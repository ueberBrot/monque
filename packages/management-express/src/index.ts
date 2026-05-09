import {
	createManagementSurface,
	generateManagementOpenApiDocument,
	type ManagementOpenApiContext,
	type ManagementOptions,
} from '@monque/management';
import { type NextFunction, type Request, type Response, Router } from 'express';

export interface ManagementExpressContextInput {
	req: Request;
	res: Response;
}

export type ManagementExpressContextFactory<TContext = unknown> = (
	input: ManagementExpressContextInput,
) => TContext | Promise<TContext>;

export type ManagementExpressOpenApiServerUrl =
	| string
	| ((input: ManagementExpressContextInput) => string | Promise<string>);

export interface ManagementExpressOpenApiOptions {
	path?: string;
	serverUrl?: ManagementExpressOpenApiServerUrl;
}

export interface ManagementExpressRouterOptions<TContext = unknown>
	extends ManagementOptions<TContext> {
	context?: ManagementExpressContextFactory<TContext>;
	openApi?: false | ManagementExpressOpenApiOptions;
}

type ManagementExpressOpenApiDocument = Awaited<
	ReturnType<typeof generateManagementOpenApiDocument>
>;

export function createManagementExpressRouter<TContext = unknown>(
	options: ManagementExpressRouterOptions<TContext>,
): Router {
	const router = Router();
	const { context, openApi, ...managementOptions } = options;
	const surface = createManagementSurface(managementOptions);
	const openApiOptions = normalizeOpenApiOptions(openApi);

	if (openApiOptions !== null) {
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

	router.use(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
		try {
			const result = await surface.openApiHandler.handle(createRequest(req), {
				context: await createOpenApiContext(req, res, context),
			});

			if (!result.matched) {
				next();
				return;
			}

			await sendResponse(res, result.response);
		} catch (error) {
			next(error);
		}
	});

	return router;
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

function normalizeOpenApiPath(path: string | undefined): string {
	if (path === undefined) {
		return '/openapi.json';
	}

	return path.startsWith('/') ? path : `/${path}`;
}

function normalizeServerUrl(serverUrl: string): string {
	return serverUrl === '' ? '/' : serverUrl;
}

async function createOpenApiDocument(
	req: Request,
	res: Response,
	options: Required<ManagementExpressOpenApiOptions>,
): Promise<ManagementExpressOpenApiDocument> {
	const document = structuredClone(await generateManagementOpenApiDocument());

	document.servers = [{ url: normalizeServerUrl(await resolveServerUrl(req, res, options)) }];

	return document;
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

async function createOpenApiContext<TContext>(
	req: Request,
	res: Response,
	context: ManagementExpressContextFactory<TContext> | undefined,
): Promise<ManagementOpenApiContext<TContext>> {
	if (context === undefined) {
		return {};
	}

	return {
		managementContext: await context({ req, res }),
	};
}

function createRequest(req: Request): globalThis.Request {
	const url = new URL(req.url, `${req.protocol}://${req.get('host') ?? 'localhost'}`);
	const init: RequestInit & { duplex?: 'half' } = {
		method: req.method,
		headers: createHeaders(req),
	};

	if (req.method !== 'GET' && req.method !== 'HEAD') {
		init.body = req;
		init.duplex = 'half';
	}

	return new globalThis.Request(url, init);
}

function createHeaders(req: Request): Headers {
	const headers = new Headers();

	for (const [name, value] of Object.entries(req.headers)) {
		if (value === undefined) {
			continue;
		}

		if (Array.isArray(value)) {
			for (const entry of value) {
				headers.append(name, entry);
			}
			continue;
		}

		headers.set(name, value);
	}

	return headers;
}

async function sendResponse(res: Response, response: globalThis.Response): Promise<void> {
	res.status(response.status);
	response.headers.forEach((value, key) => {
		res.setHeader(key, value);
	});

	res.send(Buffer.from(await response.arrayBuffer()));
}
