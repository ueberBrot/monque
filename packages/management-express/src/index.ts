import {
	createManagementSurface,
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

export interface ManagementExpressRouterOptions<TContext = unknown>
	extends ManagementOptions<TContext> {
	context?: ManagementExpressContextFactory<TContext>;
}

export function createManagementExpressRouter<TContext = unknown>(
	options: ManagementExpressRouterOptions<TContext>,
): Router {
	const router = Router();
	const { context, ...managementOptions } = options;
	const surface = createManagementSurface(managementOptions);

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
