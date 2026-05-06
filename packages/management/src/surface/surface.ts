import {
	type BulkOperationResult,
	type CursorOptions,
	InvalidCursorError,
	isValidJobStatus,
	type JobSelector,
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

type WritableAction = (typeof WRITABLE_ACTIONS)[number];
const ACTIONS = ['read', ...WRITABLE_ACTIONS] as const satisfies readonly ManagementAction[];
const ACTION_METHOD_BY_ACTION = {
	cancel: 'cancelJob',
	retry: 'retryJob',
	reschedule: 'rescheduleJob',
	delete: 'deleteJob',
} as const satisfies Record<WritableAction, keyof ManagementMonque>;
const BULK_ACTION_METHOD_BY_ACTION = {
	cancel: 'cancelJobs',
	retry: 'retryJobs',
	delete: 'deleteJobs',
} as const satisfies Record<Exclude<WritableAction, 'reschedule'>, keyof ManagementMonque>;
const ACTION_ROUTES = [
	{
		method: HttpMethod.POST,
		path: ManagementRoutePath.JOB_CANCEL,
		action: 'cancel',
		methodName: 'cancelJob',
	},
	{
		method: HttpMethod.POST,
		path: ManagementRoutePath.JOB_RETRY,
		action: 'retry',
		methodName: 'retryJob',
	},
	{
		method: HttpMethod.POST,
		path: ManagementRoutePath.JOB_RESCHEDULE,
		action: 'reschedule',
		methodName: 'rescheduleJob',
	},
	{
		method: HttpMethod.DELETE,
		path: ManagementRoutePath.JOB_DETAIL,
		action: 'delete',
		methodName: 'deleteJob',
	},
	{
		method: HttpMethod.POST,
		path: ManagementRoutePath.JOBS_BULK_CANCEL,
		action: 'cancel',
		methodName: 'cancelJobs',
	},
	{
		method: HttpMethod.POST,
		path: ManagementRoutePath.JOBS_BULK_RETRY,
		action: 'retry',
		methodName: 'retryJobs',
	},
	{
		method: HttpMethod.POST,
		path: ManagementRoutePath.JOBS_BULK_DELETE,
		action: 'delete',
		methodName: 'deleteJobs',
	},
] as const satisfies ReadonlyArray<{
	method: ManagementRoute['method'];
	path: ManagementRoute['path'];
	action: WritableAction;
	methodName: keyof ManagementMonque;
}>;
const ISO_DATE_TIME_PATTERN =
	/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;

const DEFAULT_CAPABILITY_ACTIONS = {
	read: false,
	cancel: false,
	retry: false,
	reschedule: false,
	delete: false,
} satisfies CapabilityActionsDto & Record<(typeof ACTIONS)[number], boolean>;
const JOB_SELECTOR_FIELDS = ['name', 'status', 'olderThan', 'newerThan'] as const;

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
					return await handleJobMutation(
						options,
						request,
						'cancel',
						options.monque.cancelJob?.bind(options.monque),
					);
				}

				if (request.method === HttpMethod.POST && request.path === ManagementRoutePath.JOB_RETRY) {
					return await handleJobMutation(
						options,
						request,
						'retry',
						options.monque.retryJob?.bind(options.monque),
					);
				}

				if (
					request.method === HttpMethod.POST &&
					request.path === ManagementRoutePath.JOBS_BULK_CANCEL
				) {
					return await handleBulkJobMutation(
						options,
						request,
						'cancel',
						options.monque.cancelJobs?.bind(options.monque),
					);
				}

				if (
					request.method === HttpMethod.POST &&
					request.path === ManagementRoutePath.JOBS_BULK_RETRY
				) {
					return await handleBulkJobMutation(
						options,
						request,
						'retry',
						options.monque.retryJobs?.bind(options.monque),
					);
				}

				if (
					request.method === HttpMethod.POST &&
					request.path === ManagementRoutePath.JOBS_BULK_DELETE
				) {
					return await handleBulkJobMutation(
						options,
						request,
						'delete',
						options.monque.deleteJobs?.bind(options.monque),
					);
				}

				if (
					request.method === HttpMethod.POST &&
					request.path === ManagementRoutePath.JOB_RESCHEDULE
				) {
					const writeAuthorization = requireWritableAction(options);

					if (writeAuthorization) {
						return writeAuthorization;
					}

					const body = parseRescheduleBody(request.body);

					if ('error' in body) {
						return badRequest(body.error);
					}

					const rescheduleJob = options.monque.rescheduleJob;
					const boundRescheduleJob = rescheduleJob?.bind(options.monque);

					return await handleJobMutation(
						options,
						request,
						'reschedule',
						boundRescheduleJob ? (id) => boundRescheduleJob(id, body.nextRunAt) : undefined,
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

	if (!isValidIsoDateTime(nextRunAt)) {
		return { error: 'Invalid nextRunAt' };
	}

	const date = new Date(nextRunAt);

	if (Number.isNaN(date.getTime())) {
		return { error: 'Invalid nextRunAt' };
	}

	return { nextRunAt: date };
}

function parseJobSelector(body: unknown): JobSelector | { error: string } {
	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		return { error: 'Invalid job selector' };
	}

	const input = body as Record<string, unknown>;
	const selector: JobSelector = {};
	const name = input['name'];
	const status = input['status'];
	const olderThan = input['olderThan'];
	const newerThan = input['newerThan'];

	for (const key of Object.keys(input)) {
		if (!JOB_SELECTOR_FIELDS.some((field) => field === key)) {
			return { error: 'Invalid job selector' };
		}
	}

	if (name !== undefined) {
		if (typeof name !== 'string') {
			return { error: 'Invalid selector name' };
		}

		selector.name = name;
	}

	const statuses = parseSelectorStatuses(status);

	if ('error' in statuses) {
		return statuses;
	}

	if (statuses.status !== undefined) {
		selector.status = statuses.status;
	}

	const olderThanDate = parseOptionalIsoDateTime(olderThan, 'olderThan');

	if ('error' in olderThanDate) {
		return olderThanDate;
	}

	if (olderThanDate.value !== undefined) {
		selector.olderThan = olderThanDate.value;
	}

	const newerThanDate = parseOptionalIsoDateTime(newerThan, 'newerThan');

	if ('error' in newerThanDate) {
		return newerThanDate;
	}

	if (newerThanDate.value !== undefined) {
		selector.newerThan = newerThanDate.value;
	}

	return selector;
}

function parseSelectorStatuses(
	value: unknown,
): { status: JobStatusType | JobStatusType[] | undefined } | { error: string } {
	if (value === undefined) {
		return { status: undefined };
	}

	if (typeof value === 'string') {
		if (!isValidJobStatus(value)) {
			return { error: 'Invalid status' };
		}

		return { status: value };
	}

	if (!Array.isArray(value) || value.length === 0) {
		return { error: 'Invalid status' };
	}

	const statuses: JobStatusType[] = [];

	for (const status of value) {
		if (typeof status !== 'string' || !isValidJobStatus(status)) {
			return { error: 'Invalid status' };
		}

		statuses.push(status);
	}

	return { status: statuses };
}

function parseOptionalIsoDateTime(
	value: unknown,
	fieldName: 'olderThan' | 'newerThan',
): { value: Date | undefined } | { error: string } {
	if (value === undefined) {
		return { value: undefined };
	}

	if (typeof value !== 'string') {
		return { error: `Invalid ${fieldName}` };
	}

	if (!isValidIsoDateTime(value)) {
		return { error: `Invalid ${fieldName}` };
	}

	const date = new Date(value);

	if (Number.isNaN(date.getTime())) {
		return { error: `Invalid ${fieldName}` };
	}

	return { value: date };
}

function isValidIsoDateTime(value: string): boolean {
	const match = ISO_DATE_TIME_PATTERN.exec(value);

	if (!match) {
		return false;
	}

	const [, yearValue, monthValue, dayValue, hourValue, minuteValue, secondValue] = match;
	const year = Number(yearValue);
	const month = Number(monthValue);
	const day = Number(dayValue);
	const hour = Number(hourValue);
	const minute = Number(minuteValue);
	const second = Number(secondValue);

	if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
		return false;
	}

	const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

	return (
		utcDate.getUTCFullYear() === year &&
		utcDate.getUTCMonth() === month - 1 &&
		utcDate.getUTCDate() === day &&
		utcDate.getUTCHours() === hour &&
		utcDate.getUTCMinutes() === minute &&
		utcDate.getUTCSeconds() === second
	);
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
	const boundDeleteJob = deleteJob?.bind(options.monque);

	if (!boundDeleteJob) {
		return unsupportedAction();
	}

	const deleted = await boundDeleteJob(target.id.toHexString());

	if (!deleted) {
		return notFound('Job not found');
	}

	return ok({ deleted: true as const });
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

	return ok(await mutate(target.selector));
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
	value: ManagementQueryValue | unknown,
): { status: JobStatusType | JobStatusType[] | undefined } | { error: string } {
	if (value === undefined) {
		return { status: undefined };
	}

	if (typeof value !== 'string' && !Array.isArray(value)) {
		return { error: 'Invalid status' };
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
	const actionRoute = ACTION_ROUTES.find(
		(candidate) => candidate.method === route.method && candidate.path === route.path,
	);

	return actionRoute ? monque[actionRoute.methodName] !== undefined : true;
}

function isActionSupported(monque: ManagementMonque, action: ManagementAction): boolean {
	if (action === 'read') {
		return true;
	}

	return (
		isSingleActionSupported(monque, action) ||
		(action !== 'reschedule' && monque[BULK_ACTION_METHOD_BY_ACTION[action]] !== undefined)
	);
}

function isSingleActionSupported(monque: ManagementMonque, action: WritableAction): boolean {
	return monque[ACTION_METHOD_BY_ACTION[action]] !== undefined;
}

function isBulkActionSupported(
	monque: ManagementMonque,
	action: Exclude<WritableAction, 'reschedule'>,
): boolean {
	return monque[BULK_ACTION_METHOD_BY_ACTION[action]] !== undefined;
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
