import type { ManagementOpenApiContext } from '@monque/management';
import type { Request, Response } from 'express';

import type { ManagementExpressContextFactory } from './types.js';

export async function createOpenApiContext<TContext>(
	req: Request,
	res: Response,
	context: ManagementExpressContextFactory<TContext> | undefined,
): Promise<ManagementOpenApiContext<TContext>> {
	if (context === undefined) {
		return {
			managementContext: {} as TContext,
		};
	}

	return {
		managementContext: await context({ req, res }),
	};
}
