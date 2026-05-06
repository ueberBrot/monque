import { MANAGEMENT_ROUTE_MAP } from '../routes/index.js';
import type { ManagementRequest, ManagementRoute } from '../surface/index.js';

export interface InvalidManagementRequestPath {
	error: 'Invalid request path';
}

function matchPath(
	routePath: ManagementRoute['path'],
	requestPath: string,
): { params: Record<string, string> } | InvalidManagementRequestPath | undefined {
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

			const decodedSegment = decodePathSegment(requestSegment);

			if (decodedSegment === undefined) {
				return { error: 'Invalid request path' };
			}

			params[paramName] = decodedSegment;
			continue;
		}

		if (routeSegment !== requestSegment) {
			return undefined;
		}
	}

	return { params };
}

function decodePathSegment(segment: string): string | undefined {
	try {
		return decodeURIComponent(segment);
	} catch {
		return undefined;
	}
}

export function normalizeManagementRequest<TContext>(
	request: ManagementRequest<TContext>,
): ManagementRequest<TContext> | InvalidManagementRequestPath | undefined {
	for (const route of MANAGEMENT_ROUTE_MAP) {
		if (route.method !== request.method) {
			continue;
		}

		if (route.path === request.path) {
			return request;
		}

		const match = matchPath(route.path, request.path);

		if (!match) {
			continue;
		}

		if ('error' in match) {
			return match;
		}

		return {
			...request,
			path: route.path,
			params: {
				...match.params,
				...request.params,
			},
		};
	}

	return undefined;
}
