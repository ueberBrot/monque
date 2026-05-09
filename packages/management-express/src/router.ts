import { createManagementSurface, type ManagementOpenApiContext } from '@monque/management';
import { type NextFunction, type Request, type Response, Router } from 'express';

import { createRequest, sendResponse } from './http.js';
import { createOpenApiDocument, normalizeOpenApiOptions } from './openapi.js';
import type { ManagementExpressContextFactory, ManagementExpressRouterOptions } from './types.js';

/**
 * Creates an Express router for the Monque Management Surface.
 *
 * Mount the returned router in the host Express application at the path where operators
 * should access management endpoints. Management API routes are served by the oRPC OpenAPI
 * HTTP handler from `@monque/management`, so the Express adapter follows the same
 * Management Route Map contract and response DTOs as other Management Adapters.
 *
 * By default, the router also serves OpenAPI JSON at `/openapi.json` relative to the mount
 * path. Disable that route with `openApi: false`, or configure its path and server URL with
 * `openApi`.
 *
 * Authentication belongs to the host Express app. Mount authentication middleware before
 * this router, then use `context` and the framework-neutral `authorize` hook for
 * action-grained Management Surface authorization.
 *
 * @typeParam TContext - Application-specific context exposed to management hooks.
 * @param options - Monque Management Surface options plus Express adapter options.
 * @returns An Express router that can be mounted with `app.use()`.
 *
 * @example Basic mount.
 * ```typescript
 * app.use(
 * 	'/monque',
 * 	createManagementExpressRouter({
 * 		monque,
 * 	}),
 * );
 * ```
 *
 * @example Host authentication plus request context.
 * ```typescript
 * app.use(
 * 	'/monque',
 * 	requireOperator,
 * 	createManagementExpressRouter<{ userId: string; role: string }>({
 * 		monque,
 * 		context: ({ req }) => ({
 * 			userId: req.get('x-user-id') ?? 'anonymous',
 * 			role: req.get('x-role') ?? 'viewer',
 * 		}),
 * 		authorize: ({ action, context }) => {
 * 			return context.role === 'operator' || action === 'read';
 * 		},
 * 	}),
 * );
 * ```
 *
 * @example Custom OpenAPI JSON path and public server URL.
 * ```typescript
 * app.use(
 * 	'/internal/management',
 * 	createManagementExpressRouter({
 * 		monque,
 * 		openApi: {
 * 			path: '/docs/openapi.json',
 * 			serverUrl: 'https://ops.example.com/internal/management',
 * 		},
 * 	}),
 * );
 * ```
 */
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
