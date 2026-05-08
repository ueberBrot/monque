import {
	type BulkOperationResult,
	InvalidCursorError,
	type JobSelector,
	JobStateError,
	type PersistedJob,
} from '@monque/core';
import { implement, ORPCError } from '@orpc/server';

import {
	toBulkActionResultDto,
	toDeleteJobDto,
	toJobCursorPageDto,
	toJobDto,
	toQueueStatsDto,
	toQueueViewSummaryListDto,
	toSchedulerHealthDto,
} from '../dtos/index.js';
import type { JobListQueryDto, JobSelectorDto } from '../schemas/index.js';
import { getManagementCapabilities } from '../surface/capabilities.js';
import type {
	ManagementAction,
	ManagementOpenApiContext,
	ManagementOptions,
	ManagementQueryValue,
} from '../surface/index.js';
import { parseJobListQuery, parseObjectId } from '../validation/index.js';
import { managementContract } from './contract.js';

type BulkManagementAction = Exclude<ManagementAction, 'read' | 'reschedule'>;
type BulkJobMutator = (selector: JobSelector) => Promise<BulkOperationResult>;
type SingleJobMutationAction = Exclude<ManagementAction, 'read' | 'delete' | 'reschedule'>;
type SingleJobMutator = (id: string) => Promise<PersistedJob | null>;
type RescheduleJobMutator = (id: string, runAt: Date) => Promise<PersistedJob | null>;
type DeleteJobMutator = (id: string) => Promise<boolean>;

export function createManagementRouter<TContext = unknown>(options: ManagementOptions<TContext>) {
	const managementImplementer =
		implement(managementContract).$context<ManagementOpenApiContext<TContext>>();

	return managementImplementer.router({
		health: managementImplementer.health.handler(() =>
			toSchedulerHealthDto(options.monque.isHealthy()),
		),
		capabilities: managementImplementer.capabilities.handler(({ context }) =>
			getManagementCapabilities(options, context.managementContext as TContext),
		),
		queueViews: managementImplementer.queueViews.handler(async ({ context }) => {
			await requireReadAuthorization(options, context.managementContext as TContext);

			return toQueueViewSummaryListDto(await options.monque.getQueueViewSummaries());
		}),
		jobs: managementImplementer.jobs.handler(async ({ input, context }) => {
			await requireReadAuthorization(options, context.managementContext as TContext);

			const cursorOptions = parseJobListQuery(toManagementQuery(input));

			if ('error' in cursorOptions) {
				throw new ORPCError('BAD_REQUEST', { message: cursorOptions.error });
			}

			try {
				return await toJobCursorPageDto(
					options,
					await options.monque.getJobsWithCursor(cursorOptions),
					context.managementContext as TContext,
				);
			} catch (error) {
				if (error instanceof InvalidCursorError) {
					throw new ORPCError('BAD_REQUEST', { message: error.message });
				}

				throw error;
			}
		}),
		jobStats: managementImplementer.jobStats.handler(async ({ input, context }) => {
			await requireReadAuthorization(options, context.managementContext as TContext);

			return toQueueStatsDto(
				await options.monque.getQueueStats(
					input.name === undefined ? undefined : { name: input.name },
				),
			);
		}),
		job: managementImplementer.job.handler(async ({ input, context }) => {
			await requireReadAuthorization(options, context.managementContext as TContext);

			const id = parseObjectId(input.params.id);

			if ('error' in id) {
				throw new ORPCError('BAD_REQUEST', { message: id.error });
			}

			const job = await options.monque.getJob(id.value);

			if (!job) {
				throw new ORPCError('NOT_FOUND', { message: 'Job not found' });
			}

			return toJobDto(options, job, context.managementContext as TContext);
		}),
		cancelJob: managementImplementer.cancelJob.handler(async ({ input, context }) =>
			handleSingleJobMutation(
				options,
				'cancel',
				input.params.id,
				context.managementContext as TContext,
				options.monque.cancelJob?.bind(options.monque),
			),
		),
		retryJob: managementImplementer.retryJob.handler(async ({ input, context }) =>
			handleSingleJobMutation(
				options,
				'retry',
				input.params.id,
				context.managementContext as TContext,
				options.monque.retryJob?.bind(options.monque),
			),
		),
		rescheduleJob: managementImplementer.rescheduleJob.handler(async ({ input, context }) =>
			handleRescheduleJob(
				options,
				input.params.id,
				input.body.nextRunAt,
				context.managementContext as TContext,
				options.monque.rescheduleJob?.bind(options.monque),
			),
		),
		deleteJob: managementImplementer.deleteJob.handler(async ({ input, context }) =>
			handleDeleteJob(
				options,
				input.params.id,
				context.managementContext as TContext,
				options.monque.deleteJob?.bind(options.monque),
			),
		),
		cancelJobs: managementImplementer.cancelJobs.handler(async ({ input, context }) =>
			handleBulkJobMutation(
				options,
				'cancel',
				input,
				context.managementContext as TContext,
				options.monque.cancelJobs?.bind(options.monque),
			),
		),
		retryJobs: managementImplementer.retryJobs.handler(async ({ input, context }) =>
			handleBulkJobMutation(
				options,
				'retry',
				input,
				context.managementContext as TContext,
				options.monque.retryJobs?.bind(options.monque),
			),
		),
		deleteJobs: managementImplementer.deleteJobs.handler(async ({ input, context }) =>
			handleBulkJobMutation(
				options,
				'delete',
				input,
				context.managementContext as TContext,
				options.monque.deleteJobs?.bind(options.monque),
			),
		),
	});
}

async function handleSingleJobMutation<TContext>(
	options: ManagementOptions<TContext>,
	action: SingleJobMutationAction,
	idInput: string,
	context: TContext,
	mutate: SingleJobMutator | undefined,
) {
	if (options.readOnly) {
		throw new ORPCError('FORBIDDEN', { message: 'Management surface is read-only' });
	}

	if (!mutate) {
		throw new ORPCError('FORBIDDEN', { message: 'Unsupported action' });
	}

	const id = parseObjectId(idInput);

	if ('error' in id) {
		throw new ORPCError('BAD_REQUEST', { message: id.error });
	}

	const target = await options.monque.getJob(id.value);

	if (!target) {
		throw new ORPCError('NOT_FOUND', { message: 'Job not found' });
	}

	if (!(await isAllowedByAuthorization(options, action, context, target))) {
		throw new ORPCError('FORBIDDEN', { message: 'Action denied' });
	}

	try {
		const job = await mutate(id.value.toHexString());

		if (!job) {
			throw new ORPCError('NOT_FOUND', { message: 'Job not found' });
		}

		return toJobDto(options, job, context);
	} catch (error) {
		if (error instanceof JobStateError) {
			throw new ORPCError('CONFLICT', { message: error.message });
		}

		throw error;
	}
}

async function handleRescheduleJob<TContext>(
	options: ManagementOptions<TContext>,
	idInput: string,
	nextRunAtInput: string,
	context: TContext,
	mutate: RescheduleJobMutator | undefined,
) {
	if (options.readOnly) {
		throw new ORPCError('FORBIDDEN', { message: 'Management surface is read-only' });
	}

	if (!mutate) {
		throw new ORPCError('FORBIDDEN', { message: 'Unsupported action' });
	}

	const id = parseObjectId(idInput);

	if ('error' in id) {
		throw new ORPCError('BAD_REQUEST', { message: id.error });
	}

	const target = await options.monque.getJob(id.value);

	if (!target) {
		throw new ORPCError('NOT_FOUND', { message: 'Job not found' });
	}

	if (!(await isAllowedByAuthorization(options, 'reschedule', context, target))) {
		throw new ORPCError('FORBIDDEN', { message: 'Action denied' });
	}

	try {
		const job = await mutate(id.value.toHexString(), new Date(nextRunAtInput));

		if (!job) {
			throw new ORPCError('NOT_FOUND', { message: 'Job not found' });
		}

		return toJobDto(options, job, context);
	} catch (error) {
		if (error instanceof JobStateError) {
			throw new ORPCError('CONFLICT', { message: error.message });
		}

		throw error;
	}
}

async function handleDeleteJob<TContext>(
	options: ManagementOptions<TContext>,
	idInput: string,
	context: TContext,
	mutate: DeleteJobMutator | undefined,
) {
	if (options.readOnly) {
		throw new ORPCError('FORBIDDEN', { message: 'Management surface is read-only' });
	}

	if (!mutate) {
		throw new ORPCError('FORBIDDEN', { message: 'Unsupported action' });
	}

	const id = parseObjectId(idInput);

	if ('error' in id) {
		throw new ORPCError('BAD_REQUEST', { message: id.error });
	}

	const target = await options.monque.getJob(id.value);

	if (!target) {
		throw new ORPCError('NOT_FOUND', { message: 'Job not found' });
	}

	if (!(await isAllowedByAuthorization(options, 'delete', context, target))) {
		throw new ORPCError('FORBIDDEN', { message: 'Action denied' });
	}

	const deleted = await mutate(id.value.toHexString());

	if (!deleted) {
		throw new ORPCError('NOT_FOUND', { message: 'Job not found' });
	}

	return toDeleteJobDto();
}

function toManagementQuery(input: JobListQueryDto): Record<string, ManagementQueryValue> {
	const query: Record<string, ManagementQueryValue> = {};

	if (input.cursor !== undefined) {
		query['cursor'] = input.cursor;
	}

	if (input.limit !== undefined) {
		query['limit'] = input.limit;
	}

	if (input.name !== undefined) {
		query['name'] = input.name;
	}

	if (input.status !== undefined) {
		query['status'] = input.status;
	}

	return query;
}

async function handleBulkJobMutation<TContext>(
	options: ManagementOptions<TContext>,
	action: BulkManagementAction,
	input: JobSelectorDto,
	context: TContext,
	mutate: BulkJobMutator | undefined,
) {
	if (options.readOnly) {
		throw new ORPCError('FORBIDDEN', { message: 'Management surface is read-only' });
	}

	if (!mutate) {
		throw new ORPCError('FORBIDDEN', { message: 'Unsupported action' });
	}

	const selector = toManagementSelector(input);

	if (!(await isAllowedByAuthorization(options, action, context, undefined, selector))) {
		throw new ORPCError('FORBIDDEN', { message: 'Action denied' });
	}

	try {
		return toBulkActionResultDto(await mutate(selector));
	} catch (error) {
		if (error instanceof JobStateError) {
			throw new ORPCError('CONFLICT', { message: error.message });
		}

		throw error;
	}
}

function toManagementSelector(input: JobSelectorDto): JobSelector {
	const selector: JobSelector = {};

	if (input.name !== undefined) {
		selector.name = input.name;
	}

	if (input.status !== undefined) {
		selector.status = input.status;
	}

	if (input.olderThan !== undefined) {
		selector.olderThan = new Date(input.olderThan);
	}

	if (input.newerThan !== undefined) {
		selector.newerThan = new Date(input.newerThan);
	}

	return selector;
}

export type ManagementRouter = ReturnType<typeof createManagementRouter>;

async function requireReadAuthorization<TContext>(
	options: ManagementOptions<TContext>,
	context: TContext,
): Promise<void> {
	if (await isAllowedByAuthorization(options, 'read', context)) {
		return;
	}

	throw new ORPCError('FORBIDDEN', { message: 'Read access denied' });
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
