import { MANAGEMENT_ROUTE_MAP } from '../routes/index.js';
import type { ManagementRequest, ManagementRoute } from '../surface/index.js';

function matchPath(
	routePath: ManagementRoute['path'],
	requestPath: string,
): Record<string, string> | undefined {
	const routeSegments = routePath.split('/').filter((segment) => segment.length > 0);
	const requestSegments = requestPath.split('/').filter((segment) => segment.length > 0);

	if (routeSegments.length !== requestSegments.length) {
		return undefined;
	}

	const params: Record<string, string> = {};

	for (let index = 0; index < routeSegments.length; index += 1) {
		const routeSegment = routeSegments[index];
		const requestSegment = requestSegments[index];

		if (routeSegment === undefined || requestSegment === undefined) {
			return undefined;
		}

		if (routeSegment.startsWith('{') && routeSegment.endsWith('}')) {
			const paramName = routeSegment.slice(1, -1);

			if (!paramName) {
				return undefined;
			}

			params[paramName] = decodeURIComponent(requestSegment);
			continue;
		}

		if (routeSegment !== requestSegment) {
			return undefined;
		}
	}

	return params;
}

export function normalizeManagementRequest<TContext>(
	request: ManagementRequest<TContext>,
): ManagementRequest<TContext> | undefined {
	for (const route of MANAGEMENT_ROUTE_MAP) {
		if (route.method !== request.method) {
			continue;
		}

		if (route.path === request.path) {
			return request;
		}

		const params = matchPath(route.path, request.path);

		if (!params) {
			continue;
		}

		return {
			...request,
			path: route.path,
			params: {
				...params,
				...request.params,
			},
		};
	}

	return undefined;
}
