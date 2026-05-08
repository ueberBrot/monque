import { OpenAPIHandler } from '@orpc/openapi/fetch';

import { createManagementRouter } from '../orpc/index.js';
import type { ManagementOptions, ManagementSurface } from './types.js';

export function createManagementSurface<TContext = unknown>(
	options: ManagementOptions<TContext>,
): ManagementSurface<TContext> {
	return {
		openApiHandler: new OpenAPIHandler(createManagementRouter(options), {
			customErrorResponseBodyEncoder: (error) => ({ error: error.message }),
		}),
	};
}
