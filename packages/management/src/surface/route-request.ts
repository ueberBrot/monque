import { normalizeManagementRequest } from '../request/index.js';
import { findManagementRoute } from '../routes/index.js';
import { badRequest, notFound } from './responses.js';
import type { ManagementRequest, ManagementResponse, ManagementRoute } from './types.js';

export interface RoutedManagementRequest<TContext> {
	request: ManagementRequest<TContext>;
	route: ManagementRoute;
}

export function routeManagementRequest<TContext>(
	request: ManagementRequest<TContext>,
): RoutedManagementRequest<TContext> | ManagementResponse<{ error: string }> {
	const managementRequest = normalizeManagementRequest(request);

	if (!managementRequest) {
		return notFound('Management route not found');
	}

	if ('error' in managementRequest) {
		return badRequest(managementRequest.error);
	}

	const route = findManagementRoute(managementRequest.method, managementRequest.path);

	if (!route) {
		return notFound('Management route not found');
	}

	return {
		request: managementRequest,
		route,
	};
}
