import { InvalidCursorError, JobStateError } from '@monque/core';

import {
	toJobCursorPageDto,
	toJobDto,
	toQueueStatsDto,
	toQueueViewSummaryListDto,
	toSchedulerHealthDto,
} from '../dtos/index.js';
import { MANAGEMENT_ROUTE_MAP } from '../routes/index.js';
import { getSingleQueryValue, parseJobListQuery, parseObjectId } from '../validation/index.js';
import {
	handleBulkJobMutation,
	handleDeleteJobAction,
	handleRescheduleJobAction,
	handleSingleJobMutation,
} from './job-actions.js';
import { badRequest, conflict, forbidden, internalServerError, notFound, ok } from './responses.js';
import { routeManagementRequest } from './route-request.js';
import type {
	CapabilitiesDto,
	CapabilityActionsDto,
	ManagementAction,
	ManagementMonque,
	ManagementOptions,
	ManagementRequest,
	ManagementResponse,
	ManagementRoute,
	ManagementSurface,
} from './types.js';

const WRITABLE_ACTIONS = [
	'cancel',
	'retry',
	'reschedule',
	'delete',
] as const satisfies readonly ManagementAction[];

const ACTIONS = ['read', ...WRITABLE_ACTIONS] as const satisfies readonly ManagementAction[];

const DEFAULT_CAPABILITY_ACTIONS = {
	read: false,
	cancel: false,
	retry: false,
	reschedule: false,
	delete: false,
} satisfies CapabilityActionsDto & Record<(typeof ACTIONS)[number], boolean>;

export function createManagementSurface<TContext = unknown>(
	options: ManagementOptions<TContext>,
): ManagementSurface<TContext> {
	return {
		routes: getSupportedRoutes(options.monque),
		async handle(request: ManagementRequest<TContext>): Promise<ManagementResponse> {
			try {
				const routedRequest = routeManagementRequest(request);

				if ('status' in routedRequest) {
					return routedRequest;
				}

				const { request: managementRequest, route } = routedRequest;

				switch (route.operationId) {
					case 'getSchedulerHealth':
						return ok(toSchedulerHealthDto(options.monque.isHealthy()));
					case 'getCapabilities':
						return ok(await getCapabilities(options, managementRequest.context));
					case 'listQueueViews': {
						const readAuthorization = await requireReadAuthorization(
							options,
							managementRequest.context,
						);

						if (readAuthorization) {
							return readAuthorization;
						}

						return ok(toQueueViewSummaryListDto(await options.monque.getQueueViewSummaries()));
					}
					case 'listJobs': {
						const readAuthorization = await requireReadAuthorization(
							options,
							managementRequest.context,
						);

						if (readAuthorization) {
							return readAuthorization;
						}

						const cursorOptions = parseJobListQuery(managementRequest.query);

						if ('error' in cursorOptions) {
							return badRequest(cursorOptions.error);
						}

						return ok(
							await toJobCursorPageDto(
								options,
								await options.monque.getJobsWithCursor(cursorOptions),
								managementRequest.context,
							),
						);
					}
					case 'getJobStats': {
						const readAuthorization = await requireReadAuthorization(
							options,
							managementRequest.context,
						);

						if (readAuthorization) {
							return readAuthorization;
						}

						const name = getSingleQueryValue(managementRequest.query?.['name']);

						if ('error' in name) {
							return badRequest(name.error);
						}

						return ok(
							toQueueStatsDto(
								await options.monque.getQueueStats(
									name.value === undefined ? undefined : { name: name.value },
								),
							),
						);
					}
					case 'getJob': {
						const readAuthorization = await requireReadAuthorization(
							options,
							managementRequest.context,
						);

						if (readAuthorization) {
							return readAuthorization;
						}

						const id = parseObjectId(managementRequest.params?.['id']);

						if ('error' in id) {
							return badRequest(id.error);
						}

						const job = await options.monque.getJob(id.value);

						if (!job) {
							return notFound('Job not found');
						}

						return ok(await toJobDto(options, job, managementRequest.context));
					}
					case 'deleteJob':
						return await handleDeleteJobAction(options, managementRequest);
					case 'cancelJob':
						return await handleSingleJobMutation(
							options,
							managementRequest,
							'cancel',
							options.monque.cancelJob?.bind(options.monque),
						);
					case 'retryJob':
						return await handleSingleJobMutation(
							options,
							managementRequest,
							'retry',
							options.monque.retryJob?.bind(options.monque),
						);
					case 'cancelJobs':
						return await handleBulkJobMutation(
							options,
							managementRequest,
							'cancel',
							options.monque.cancelJobs?.bind(options.monque),
						);
					case 'retryJobs':
						return await handleBulkJobMutation(
							options,
							managementRequest,
							'retry',
							options.monque.retryJobs?.bind(options.monque),
						);
					case 'deleteJobs':
						return await handleBulkJobMutation(
							options,
							managementRequest,
							'delete',
							options.monque.deleteJobs?.bind(options.monque),
						);
					case 'rescheduleJob':
						return await handleRescheduleJobAction(options, managementRequest);
					default:
						return assertNeverOperation(route.operationId);
				}
			} catch (error) {
				if (error instanceof InvalidCursorError) {
					return badRequest(error.message);
				}

				if (error instanceof JobStateError) {
					return conflict(error.message);
				}

				return internalServerError();
			}
		},
	};
}

function assertNeverOperation(operationId: string): never {
	throw new Error(`Unsupported Management operation: ${operationId}`);
}

async function requireReadAuthorization<TContext>(
	options: ManagementOptions<TContext>,
	context: TContext,
): Promise<ManagementResponse<{ error: string }> | undefined> {
	if (await isAllowedByAuthorization(options, 'read', context)) {
		return undefined;
	}

	return forbidden('Read access denied');
}

async function getCapabilities<TContext>(
	options: ManagementOptions<TContext>,
	context: TContext,
): Promise<CapabilitiesDto> {
	const readOnly = options.readOnly ?? false;
	const actions: CapabilityActionsDto = { ...DEFAULT_CAPABILITY_ACTIONS };

	for (const action of ACTIONS) {
		actions[action] =
			isActionSupported(options.monque, action) &&
			isAllowedByReadOnlyMode(action, readOnly) &&
			(await isAllowedByAuthorization(options, action, context));
	}

	return {
		readOnly,
		actions,
	};
}

function isAllowedByReadOnlyMode(action: ManagementAction, readOnly: boolean): boolean {
	return !readOnly || !WRITABLE_ACTIONS.some((writableAction) => writableAction === action);
}

function getSupportedRoutes(monque: ManagementMonque): readonly ManagementRoute[] {
	return MANAGEMENT_ROUTE_MAP.filter((route) => isRouteSupported(monque, route));
}

function isRouteSupported(monque: ManagementMonque, route: ManagementRoute): boolean {
	if (route.operation.kind === 'read') {
		return true;
	}

	return monque[route.operation.method] !== undefined;
}

function isActionSupported(monque: ManagementMonque, action: ManagementAction): boolean {
	if (action === 'read') {
		return true;
	}

	return MANAGEMENT_ROUTE_MAP.some(
		(route) =>
			route.operation.kind !== 'read' &&
			route.operation.action === action &&
			isRouteSupported(monque, route),
	);
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
