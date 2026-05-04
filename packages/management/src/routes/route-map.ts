import { HttpMethod } from '../http/index.js';
import { CapabilitiesSchema, ErrorSchema, SchedulerHealthSchema } from '../schemas/index.js';
import type { ManagementRoute } from '../surface/index.js';

export const ManagementRoutePath = {
	HEALTH: '/api/v1/health',
	CAPABILITIES: '/api/v1/capabilities',
} as const;

export type ManagementRoutePathType =
	(typeof ManagementRoutePath)[keyof typeof ManagementRoutePath];

export const ManagementRouteMap = [
	{
		method: HttpMethod.GET,
		path: ManagementRoutePath.HEALTH,
		operationId: 'getSchedulerHealth',
		responseSchema: SchedulerHealthSchema,
		errorSchema: ErrorSchema,
	},
	{
		method: HttpMethod.GET,
		path: ManagementRoutePath.CAPABILITIES,
		operationId: 'getCapabilities',
		responseSchema: CapabilitiesSchema,
		errorSchema: ErrorSchema,
	},
] as const satisfies readonly ManagementRoute[];
