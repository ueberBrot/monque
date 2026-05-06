import type { BulkOperationResult, JobSelector, PersistedJob } from '@monque/core';
import type { ObjectId } from 'mongodb';

import { toBulkActionResultDto, toDeleteJobDto, toJobDto } from '../dtos/index.js';
import {
	type BulkWritableManagementActionType,
	isBulkJobManagementActionSupported,
	isSingleJobManagementActionSupported,
	type WritableManagementActionType,
} from '../routes/index.js';
import { parseJobSelector, parseObjectId, parseRescheduleBody } from '../validation/index.js';
import { badRequest, forbidden, notFound, ok, unsupportedAction } from './responses.js';
import type {
	ManagementAction,
	ManagementOptions,
	ManagementRequest,
	ManagementResponse,
} from './types.js';

type SingleJobMutationAction = Exclude<WritableManagementActionType, 'delete'>;

export async function handleSingleJobMutation<TContext>(
	options: ManagementOptions<TContext>,
	request: ManagementRequest<TContext>,
	action: SingleJobMutationAction,
	mutate: ((id: string) => Promise<PersistedJob | null>) | undefined,
): Promise<ManagementResponse> {
	const actionCheck = requireSingleActionSupport(options, action);

	if (actionCheck) {
		return actionCheck;
	}

	const target = await resolveMutableJobTarget(options, request, action);

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

export async function handleRescheduleJobAction<TContext>(
	options: ManagementOptions<TContext>,
	request: ManagementRequest<TContext>,
): Promise<ManagementResponse> {
	const actionCheck = requireSingleActionSupport(options, 'reschedule');

	if (actionCheck) {
		return actionCheck;
	}

	const body = parseRescheduleBody(request.body);

	if ('error' in body) {
		return badRequest(body.error);
	}

	const rescheduleJob = options.monque.rescheduleJob;
	const boundRescheduleJob = rescheduleJob?.bind(options.monque);

	return await mutateSingleJob(
		options,
		request,
		'reschedule',
		boundRescheduleJob ? (id) => boundRescheduleJob(id, body.nextRunAt) : undefined,
	);
}

export async function handleDeleteJobAction<TContext>(
	options: ManagementOptions<TContext>,
	request: ManagementRequest<TContext>,
): Promise<ManagementResponse> {
	const actionCheck = requireSingleActionSupport(options, 'delete');

	if (actionCheck) {
		return actionCheck;
	}

	const target = await resolveMutableJobTarget(options, request, 'delete');

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

export async function handleBulkJobMutation<TContext>(
	options: ManagementOptions<TContext>,
	request: ManagementRequest<TContext>,
	action: BulkWritableManagementActionType,
	mutate: ((selector: JobSelector) => Promise<BulkOperationResult>) | undefined,
): Promise<ManagementResponse> {
	const actionCheck = requireBulkActionSupport(options, action);

	if (actionCheck) {
		return actionCheck;
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

	if (!mutate) {
		return unsupportedAction();
	}

	return ok(toBulkActionResultDto(await mutate(selector)));
}

async function mutateSingleJob<TContext>(
	options: ManagementOptions<TContext>,
	request: ManagementRequest<TContext>,
	action: SingleJobMutationAction,
	mutate: ((id: string) => Promise<PersistedJob | null>) | undefined,
): Promise<ManagementResponse> {
	const target = await resolveMutableJobTarget(options, request, action);

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

function requireSingleActionSupport<TContext>(
	options: ManagementOptions<TContext>,
	action: WritableManagementActionType,
): ManagementResponse<{ error: string }> | undefined {
	const writeAuthorization = requireWritableAction(options);

	if (writeAuthorization) {
		return writeAuthorization;
	}

	if (!isSingleJobManagementActionSupported(options.monque, action)) {
		return unsupportedAction();
	}

	return undefined;
}

function requireBulkActionSupport<TContext>(
	options: ManagementOptions<TContext>,
	action: BulkWritableManagementActionType,
): ManagementResponse<{ error: string }> | undefined {
	const writeAuthorization = requireWritableAction(options);

	if (writeAuthorization) {
		return writeAuthorization;
	}

	if (!isBulkJobManagementActionSupported(options.monque, action)) {
		return unsupportedAction();
	}

	return undefined;
}

function requireWritableAction<TContext>(
	options: ManagementOptions<TContext>,
): ManagementResponse<{ error: string }> | undefined {
	if (!options.readOnly) {
		return undefined;
	}

	return forbidden('Management surface is read-only');
}

async function resolveMutableJobTarget<TContext>(
	options: ManagementOptions<TContext>,
	request: ManagementRequest<TContext>,
	action: WritableManagementActionType,
): Promise<{ id: ObjectId } | ManagementResponse<{ error: string }>> {
	const id = parseObjectId(request.params?.['id']);

	if ('error' in id) {
		return badRequest(id.error);
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

async function requireBulkActionAuthorization<TContext>(
	options: ManagementOptions<TContext>,
	action: BulkWritableManagementActionType,
	context: TContext,
	selector: JobSelector,
): Promise<ManagementResponse<{ error: string }> | undefined> {
	if (await isAllowedByAuthorization(options, action, context, undefined, selector)) {
		return undefined;
	}

	return forbidden('Action denied');
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
