import { HttpMethod, HttpStatus } from '../http/index.js';
import { ManagementRouteMap, ManagementRoutePath } from '../routes/index.js';
import type {
	CapabilitiesDto,
	CapabilityActionsDto,
	ManagementAction,
	ManagementOptions,
	ManagementRequest,
	ManagementResponse,
	ManagementSurface,
	SchedulerHealthDto,
} from './types.js';

const WritableActions = ['cancel', 'retry', 'reschedule', 'delete'] as const;
const Actions = ['read', ...WritableActions] as const satisfies readonly ManagementAction[];

export function createManagementSurface<TContext = unknown>(
	options: ManagementOptions<TContext>,
): ManagementSurface<TContext> {
	return {
		routes: ManagementRouteMap,
		async handle(request: ManagementRequest<TContext>): Promise<ManagementResponse> {
			if (request.method === HttpMethod.GET && request.path === ManagementRoutePath.HEALTH) {
				return {
					status: HttpStatus.OK,
					body: getSchedulerHealth(options),
				};
			}

			if (request.method === HttpMethod.GET && request.path === ManagementRoutePath.CAPABILITIES) {
				return {
					status: HttpStatus.OK,
					body: await getCapabilities(options, request.context),
				};
			}

			return {
				status: HttpStatus.NOT_FOUND,
				body: {
					error: 'Management route not found',
				},
			};
		},
	};
}

function getSchedulerHealth<TContext>(options: ManagementOptions<TContext>): SchedulerHealthDto {
	const healthy = options.monque.isHealthy();

	return {
		status: healthy ? 'ok' : 'unavailable',
		scheduler: {
			healthy,
		},
	};
}

async function getCapabilities<TContext>(
	options: ManagementOptions<TContext>,
	context: TContext,
): Promise<CapabilitiesDto> {
	const readOnly = options.readOnly ?? false;
	const actions = {} as CapabilityActionsDto;

	for (const action of Actions) {
		actions[action] =
			isAllowedByReadOnlyMode(action, readOnly) &&
			(await isAllowedByAuthorization(options, action, context));
	}

	return {
		readOnly,
		actions,
	};
}

function isAllowedByReadOnlyMode(action: ManagementAction, readOnly: boolean): boolean {
	return !readOnly || !WritableActions.some((writableAction) => writableAction === action);
}

async function isAllowedByAuthorization<TContext>(
	options: ManagementOptions<TContext>,
	action: ManagementAction,
	context: TContext,
): Promise<boolean> {
	if (!options.authorize) {
		return true;
	}

	return options.authorize({ action, context });
}
