import {
	type BulkOperationResult,
	InvalidCursorError,
	type JobSelector,
	JobStateError,
	type PersistedJob,
} from '@monque/core';
import type { ObjectId } from 'mongodb';

import {
	toBulkActionResultDto,
	toDeleteJobDto,
	toJobCursorPageDto,
	toJobDto,
	toQueueStatsDto,
	toQueueViewSummaryListDto,
	toSchedulerHealthDto,
} from '../dtos/index.js';
import { HttpStatus } from '../http/index.js';
import { normalizeManagementRequest } from '../request/index.js';
import { findManagementRoute, MANAGEMENT_ROUTE_MAP } from '../routes/index.js';
import {
	getSingleQueryValue,
	parseJobListQuery,
	parseJobSelector,
	parseObjectId,
	parseRescheduleBody,
} from '../validation/index.js';
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

type WritableAction = (typeof WRITABLE_ACTIONS)[number];

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
				const managementRequest = normalizeManagementRequest(request);

				if (!managementRequest) {
					return notFound('Management route not found');
				}

				const route = findManagementRoute(managementRequest.method, managementRequest.path);

				if (!route) {
					return notFound('Management route not found');
				}

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
						return await handleJobMutation(
							options,
							managementRequest,
							'cancel',
							options.monque.cancelJob?.bind(options.monque),
						);
					case 'retryJob':
						return await handleJobMutation(
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
					case 'rescheduleJob': {
						const writeAuthorization = requireWritableAction(options);

						if (writeAuthorization) {
							return writeAuthorization;
						}

						const body = parseRescheduleBody(managementRequest.body);

						if ('error' in body) {
							return badRequest(body.error);
						}

						const rescheduleJob = options.monque.rescheduleJob;
						const boundRescheduleJob = rescheduleJob?.bind(options.monque);

						return await handleJobMutation(
							options,
							managementRequest,
							'reschedule',
							boundRescheduleJob ? (id) => boundRescheduleJob(id, body.nextRunAt) : undefined,
						);
					}
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

function ok<TBody>(body: TBody): ManagementResponse<TBody> {
	return {
		status: HttpStatus.OK,
		body,
	};
}

function badRequest(error: string): ManagementResponse<{ error: string }> {
	return {
		status: HttpStatus.BAD_REQUEST,
		body: { error },
	};
}

function forbidden(error: string): ManagementResponse<{ error: string }> {
	return {
		status: HttpStatus.FORBIDDEN,
		body: { error },
	};
}

function unsupportedAction(): ManagementResponse<{ error: string }> {
	return forbidden('Management action is unsupported');
}

function notFound(error: string): ManagementResponse<{ error: string }> {
	return {
		status: HttpStatus.NOT_FOUND,
		body: { error },
	};
}

function conflict(error: string): ManagementResponse<{ error: string }> {
	return {
		status: HttpStatus.CONFLICT,
		body: { error },
	};
}

function internalServerError(): ManagementResponse<{ error: string }> {
	return {
		status: HttpStatus.INTERNAL_SERVER_ERROR,
		body: { error: 'Internal server error' },
	};
}

function assertNeverOperation(operationId: string): never {
	throw new Error(`Unsupported Management operation: ${operationId}`);
}

async function handleJobMutation<TContext>(
	options: ManagementOptions<TContext>,
	request: ManagementRequest<TContext>,
	action: Exclude<WritableAction, 'delete'>,
	mutate: ((id: string) => Promise<PersistedJob | null>) | undefined,
): Promise<ManagementResponse> {
	const target = await requireMutableJobTarget(options, request, action);

	if ('status' in target) {
		return target;
	}

	if (!mutate) {
		return unsupportedAction();
	}

	const job = await mutate(target.id.toHexString());

	if (!job) {
		return notFound('Job not found');
	}

	return ok(await toJobDto(options, job, request.context));
}

async function handleDeleteJobAction<TContext>(
	options: ManagementOptions<TContext>,
	request: ManagementRequest<TContext>,
): Promise<ManagementResponse> {
	const target = await requireMutableJobTarget(options, request, 'delete');

	if ('status' in target) {
		return target;
	}

	const deleteJob = options.monque.deleteJob;
	const boundDeleteJob = deleteJob?.bind(options.monque);

	if (!boundDeleteJob) {
		return unsupportedAction();
	}

	const deleted = await boundDeleteJob(target.id.toHexString());

	if (!deleted) {
		return notFound('Job not found');
	}

	return ok(toDeleteJobDto());
}

async function handleBulkJobMutation<TContext>(
	options: ManagementOptions<TContext>,
	request: ManagementRequest<TContext>,
	action: Exclude<WritableAction, 'reschedule'>,
	mutate: ((selector: JobSelector) => Promise<BulkOperationResult>) | undefined,
): Promise<ManagementResponse> {
	const target = await requireBulkJobTarget(options, request, action);

	if ('status' in target) {
		return target;
	}

	if (!mutate) {
		return unsupportedAction();
	}

	return ok(toBulkActionResultDto(await mutate(target.selector)));
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

function requireWritableAction<TContext>(
	options: ManagementOptions<TContext>,
): ManagementResponse<{ error: string }> | undefined {
	if (!options.readOnly) {
		return undefined;
	}

	return forbidden('Management surface is read-only');
}

async function requireMutableJobTarget<TContext>(
	options: ManagementOptions<TContext>,
	request: ManagementRequest<TContext>,
	action: WritableAction,
): Promise<{ id: ObjectId } | ManagementResponse<{ error: string }>> {
	const writeAuthorization = requireWritableAction(options);

	if (writeAuthorization) {
		return writeAuthorization;
	}

	const id = parseObjectId(request.params?.['id']);

	if ('error' in id) {
		return badRequest(id.error);
	}

	if (!isSingleActionSupported(options.monque, action)) {
		return unsupportedAction();
	}

	const job = await options.monque.getJob(id.value);

	if (!job) {
		return notFound('Job not found');
	}

	const actionAuthorization = await requireActionAuthorization(
		options,
		action,
		request.context,
		job,
	);

	if (actionAuthorization) {
		return actionAuthorization;
	}

	return { id: id.value };
}

async function requireActionAuthorization<TContext>(
	options: ManagementOptions<TContext>,
	action: ManagementAction,
	context: TContext,
	job: PersistedJob,
): Promise<ManagementResponse<{ error: string }> | undefined> {
	if (await isAllowedByAuthorization(options, action, context, job)) {
		return undefined;
	}

	return forbidden('Action denied');
}

async function requireBulkJobTarget<TContext>(
	options: ManagementOptions<TContext>,
	request: ManagementRequest<TContext>,
	action: Exclude<WritableAction, 'reschedule'>,
): Promise<{ selector: JobSelector } | ManagementResponse<{ error: string }>> {
	const writeAuthorization = requireWritableAction(options);

	if (writeAuthorization) {
		return writeAuthorization;
	}

	if (!isBulkActionSupported(options.monque, action)) {
		return unsupportedAction();
	}

	const selector = parseJobSelector(request.body);

	if ('error' in selector) {
		return badRequest(selector.error);
	}

	const actionAuthorization = await requireBulkActionAuthorization(
		options,
		action,
		request.context,
		selector,
	);

	if (actionAuthorization) {
		return actionAuthorization;
	}

	return { selector };
}

async function requireBulkActionAuthorization<TContext>(
	options: ManagementOptions<TContext>,
	action: Exclude<WritableAction, 'reschedule'>,
	context: TContext,
	selector: JobSelector,
): Promise<ManagementResponse<{ error: string }> | undefined> {
	if (await isAllowedByAuthorization(options, action, context, undefined, selector)) {
		return undefined;
	}

	return forbidden('Action denied');
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

function isSingleActionSupported(monque: ManagementMonque, action: WritableAction): boolean {
	return MANAGEMENT_ROUTE_MAP.some(
		(route) =>
			route.operation.kind === 'single-job-action' &&
			route.operation.action === action &&
			isRouteSupported(monque, route),
	);
}

function isBulkActionSupported(
	monque: ManagementMonque,
	action: Exclude<WritableAction, 'reschedule'>,
): boolean {
	return MANAGEMENT_ROUTE_MAP.some(
		(route) =>
			route.operation.kind === 'bulk-job-action' &&
			route.operation.action === action &&
			isRouteSupported(monque, route),
	);
}

async function isAllowedByAuthorization<TContext>(
	options: ManagementOptions<TContext>,
	action: ManagementAction,
	context: TContext,
	job?: PersistedJob,
	selector?: JobSelector,
): Promise<boolean> {
	if (!options.authorize) {
		return true;
	}

	return options.authorize({ action, context, job, selector });
}
