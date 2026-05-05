import {
	type CursorOptions,
	InvalidCursorError,
	isValidJobStatus,
	JobStateError,
	type JobStatusType,
	type PersistedJob,
} from '@monque/core';
import { ObjectId } from 'mongodb';

import { HttpMethod, HttpStatus } from '../http/index.js';
import { MANAGEMENT_ROUTE_MAP, ManagementRoutePath } from '../routes/index.js';
import type {
	CapabilitiesDto,
	CapabilityActionsDto,
	JobCursorPageDto,
	JobDto,
	ManagementAction,
	ManagementMonque,
	ManagementOptions,
	ManagementQueryValue,
	ManagementRequest,
	ManagementResponse,
	ManagementRoute,
	ManagementSurface,
	QueueViewSummaryListDto,
	SchedulerHealthDto,
} from './types.js';

const WRITABLE_ACTIONS = [
	'cancel',
	'retry',
	'reschedule',
	'delete',
] as const satisfies readonly ManagementAction[];

function ensureAllManagementActions<const T extends readonly ManagementAction[]>(
	actions: T & ([ManagementAction] extends [T[number]] ? unknown : never),
): T {
	return actions;
}

const ACTIONS = ensureAllManagementActions(['read', ...WRITABLE_ACTIONS] as const);
type WritableAction = (typeof WRITABLE_ACTIONS)[number];

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
				if (request.method === HttpMethod.GET && request.path === ManagementRoutePath.HEALTH) {
					return ok(getSchedulerHealth(options));
				}

				if (
					request.method === HttpMethod.GET &&
					request.path === ManagementRoutePath.CAPABILITIES
				) {
					return ok(await getCapabilities(options, request.context));
				}

				if (request.method === HttpMethod.GET && request.path === ManagementRoutePath.QUEUE_VIEWS) {
					const readAuthorization = await requireReadAuthorization(options, request.context);

					if (readAuthorization) {
						return readAuthorization;
					}

					return ok(await getQueueViews(options));
				}

				if (request.method === HttpMethod.GET && request.path === ManagementRoutePath.JOBS) {
					const readAuthorization = await requireReadAuthorization(options, request.context);

					if (readAuthorization) {
						return readAuthorization;
					}

					const cursorOptions = parseJobListQuery(request.query);

					if ('error' in cursorOptions) {
						return badRequest(cursorOptions.error);
					}

					return ok(await getJobs(options, cursorOptions, request.context));
				}

				if (request.method === HttpMethod.GET && request.path === ManagementRoutePath.JOB_STATS) {
					const readAuthorization = await requireReadAuthorization(options, request.context);

					if (readAuthorization) {
						return readAuthorization;
					}

					const name = getSingleQueryValue(request.query?.['name']);

					if ('error' in name) {
						return badRequest(name.error);
					}

					return ok(
						await options.monque.getQueueStats(
							name.value === undefined ? undefined : { name: name.value },
						),
					);
				}

				if (request.method === HttpMethod.GET && request.path === ManagementRoutePath.JOB_DETAIL) {
					const readAuthorization = await requireReadAuthorization(options, request.context);

					if (readAuthorization) {
						return readAuthorization;
					}

					const id = parseObjectId(request.params?.['id']);

					if ('error' in id) {
						return badRequest(id.error);
					}

					const job = await options.monque.getJob(id.value);

					if (!job) {
						return notFound('Job not found');
					}

					return ok(await serializeJob(options, job, request.context));
				}

				if (
					request.method === HttpMethod.DELETE &&
					request.path === ManagementRoutePath.JOB_DETAIL
				) {
					return await handleDeleteJobAction(options, request);
				}

				if (request.method === HttpMethod.POST && request.path === ManagementRoutePath.JOB_CANCEL) {
					return await handleJobMutation(options, request, 'cancel', options.monque.cancelJob);
				}

				if (request.method === HttpMethod.POST && request.path === ManagementRoutePath.JOB_RETRY) {
					return await handleJobMutation(options, request, 'retry', options.monque.retryJob);
				}

				if (
					request.method === HttpMethod.POST &&
					request.path === ManagementRoutePath.JOB_RESCHEDULE
				) {
					const body = parseRescheduleBody(request.body);

					if ('error' in body) {
						return badRequest(body.error);
					}

					const rescheduleJob = options.monque.rescheduleJob;

					return await handleJobMutation(
						options,
						request,
						'reschedule',
						rescheduleJob ? (id) => rescheduleJob(id, body.nextRunAt) : undefined,
					);
				}

				return notFound('Management route not found');
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

function parseObjectId(value: string | undefined): { value: ObjectId } | { error: string } {
	if (!value || !ObjectId.isValid(value)) {
		return { error: 'Invalid job id' };
	}

	return { value: new ObjectId(value) };
}

function parseRescheduleBody(body: unknown): { nextRunAt: Date } | { error: string } {
	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		return { error: 'Invalid reschedule request' };
	}

	const nextRunAt = (body as Record<string, unknown>)['nextRunAt'];

	if (typeof nextRunAt !== 'string') {
		return { error: 'Invalid nextRunAt' };
	}

	const date = new Date(nextRunAt);

	if (Number.isNaN(date.getTime())) {
		return { error: 'Invalid nextRunAt' };
	}

	return { nextRunAt: date };
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

	return ok(await serializeJob(options, job, request.context));
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

	if (!deleteJob) {
		return unsupportedAction();
	}

	const deleted = await deleteJob(target.id.toHexString());

	if (!deleted) {
		return notFound('Job not found');
	}

	return ok({ deleted: true as const });
}

async function getJobs<TContext>(
	options: ManagementOptions<TContext>,
	cursorOptions: CursorOptions,
	context: TContext,
): Promise<JobCursorPageDto> {
	const page = await options.monque.getJobsWithCursor(cursorOptions);

	return {
		jobs: await Promise.all(
			page.jobs.map((job) => serializeJob(options, job as PersistedJob, context)),
		),
		cursor: page.cursor,
		hasNextPage: page.hasNextPage,
		hasPreviousPage: page.hasPreviousPage,
	};
}

async function serializeJob<TContext>(
	options: ManagementOptions<TContext>,
	job: PersistedJob,
	context: TContext,
): Promise<JobDto> {
	const serializePayload =
		options.serializePayloadByJobName?.[job.name] ?? options.serializePayload;
	const payload = serializePayload
		? await serializePayload({ job, payload: job.data, context })
		: job.data;
	const dto: JobDto = {
		id: job._id.toHexString(),
		name: job.name,
		status: job.status,
		payload,
		nextRunAt: job.nextRunAt.toISOString(),
		lockedAt: job.lockedAt ? job.lockedAt.toISOString() : null,
		claimedBy: job.claimedBy ?? null,
		lastHeartbeat: job.lastHeartbeat ? job.lastHeartbeat.toISOString() : null,
		failCount: job.failCount,
		failureReason: job.failReason ?? null,
		createdAt: job.createdAt.toISOString(),
		updatedAt: job.updatedAt.toISOString(),
	};

	if (job.heartbeatInterval !== undefined) {
		dto.heartbeatInterval = job.heartbeatInterval;
	}

	if (job.repeatInterval !== undefined) {
		dto.repeatInterval = job.repeatInterval;
	}

	if (job.uniqueKey !== undefined) {
		dto.uniqueKey = job.uniqueKey;
	}

	return dto;
}

function parseJobListQuery(
	query: Readonly<Record<string, ManagementQueryValue>> | undefined,
): CursorOptions | { error: string } {
	const limitResult = parseLimit(query?.['limit']);

	if ('error' in limitResult) {
		return limitResult;
	}

	const statusesResult = parseStatuses(query?.['status']);

	if ('error' in statusesResult) {
		return statusesResult;
	}

	const filter: CursorOptions['filter'] = {};
	const name = getSingleQueryValue(query?.['name']);

	if ('error' in name) {
		return name;
	}

	if (name.value !== undefined) {
		filter.name = name.value;
	}

	if (statusesResult.status !== undefined) {
		filter.status = statusesResult.status;
	}

	const cursor = getSingleQueryValue(query?.['cursor']);

	if ('error' in cursor) {
		return cursor;
	}

	const options: CursorOptions = {
		limit: limitResult.limit,
	};

	if (cursor.value !== undefined) {
		options.cursor = cursor.value;
	}

	if (Object.keys(filter).length > 0) {
		options.filter = filter;
	}

	return options;
}

function parseLimit(value: ManagementQueryValue): { limit: number } | { error: string } {
	const raw = getSingleQueryValue(value);

	if ('error' in raw) {
		return raw;
	}

	if (raw.value === undefined) {
		return { limit: 50 };
	}

	const limit = Number(raw.value);

	if (!Number.isInteger(limit) || limit < 1) {
		return { error: 'Invalid limit' };
	}

	return {
		limit: Math.min(limit, 100),
	};
}

function parseStatuses(
	value: ManagementQueryValue,
): { status: JobStatusType | JobStatusType[] | undefined } | { error: string } {
	if (value === undefined) {
		return { status: undefined };
	}

	const statuses = Array.isArray(value) ? value : [value];

	if (statuses.length === 0) {
		return { error: 'Invalid status' };
	}

	const validStatuses: JobStatusType[] = [];

	for (const status of statuses) {
		if (!isValidJobStatus(status)) {
			return { error: 'Invalid status' };
		}

		validStatuses.push(status);
	}

	return {
		status: validStatuses.length === 1 ? validStatuses[0] : validStatuses,
	};
}

function getSingleQueryValue(
	value: ManagementQueryValue,
): { value: string | undefined } | { error: string } {
	if (value === undefined || typeof value === 'string') {
		return { value };
	}

	return { error: 'Expected single query parameter' };
}

async function getQueueViews<TContext>(
	options: ManagementOptions<TContext>,
): Promise<QueueViewSummaryListDto> {
	return {
		queueViews: [...(await options.monque.getQueueViewSummaries())],
	};
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
	const id = parseObjectId(request.params?.['id']);

	if ('error' in id) {
		return badRequest(id.error);
	}

	const writeAuthorization = requireWritableAction(options);

	if (writeAuthorization) {
		return writeAuthorization;
	}

	if (!isActionSupported(options.monque, action)) {
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
	if (route.method === HttpMethod.POST && route.path === ManagementRoutePath.JOB_CANCEL) {
		return isActionSupported(monque, 'cancel');
	}

	if (route.method === HttpMethod.POST && route.path === ManagementRoutePath.JOB_RETRY) {
		return isActionSupported(monque, 'retry');
	}

	if (route.method === HttpMethod.POST && route.path === ManagementRoutePath.JOB_RESCHEDULE) {
		return isActionSupported(monque, 'reschedule');
	}

	if (route.method === HttpMethod.DELETE && route.path === ManagementRoutePath.JOB_DETAIL) {
		return isActionSupported(monque, 'delete');
	}

	return true;
}

function isActionSupported(monque: ManagementMonque, action: ManagementAction): boolean {
	switch (action) {
		case 'read':
			return true;
		case 'cancel':
			return monque.cancelJob !== undefined;
		case 'retry':
			return monque.retryJob !== undefined;
		case 'reschedule':
			return monque.rescheduleJob !== undefined;
		case 'delete':
			return monque.deleteJob !== undefined;
		default:
			return assertNever(action);
	}
}

async function isAllowedByAuthorization<TContext>(
	options: ManagementOptions<TContext>,
	action: ManagementAction,
	context: TContext,
	job?: PersistedJob,
): Promise<boolean> {
	if (!options.authorize) {
		return true;
	}

	return options.authorize({ action, context, job });
}

function assertNever(value: never): never {
	throw new Error(`Unsupported Management action: ${String(value)}`);
}
