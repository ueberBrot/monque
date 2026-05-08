import {
	type BulkOperationResult,
	InvalidCursorError,
	type JobSelector,
	JobStateError,
	type PersistedJob,
} from '@monque/core';
import { ORPCError } from '@orpc/server';

import {
	toBulkActionResultDto,
	toDeleteJobDto,
	toJobCursorPageDto,
	toJobDto,
	toQueueStatsDto,
	toQueueViewSummaryListDto,
	toSchedulerHealthDto,
} from '../mappers/index.js';
import type {
	JobDetailInputDto,
	JobListQueryDto,
	JobSelectorDto,
	RescheduleJobInputDto,
} from '../schemas/index.js';
import {
	decideManagementAction,
	decideManagementActionSupport,
	getManagementCapabilities,
	type ManagementActionTarget,
} from '../surface/action-policy.js';
import type { ManagementAction, ManagementOptions } from '../surface/index.js';
import { parseObjectId, toJobCursorOptions, toJobSelector } from '../surface/request-mapping.js';

type BulkManagementAction = Exclude<ManagementAction, 'read' | 'reschedule'>;
type BulkJobMutator = (selector: JobSelector) => Promise<BulkOperationResult>;
type SingleJobMutationAction = Exclude<ManagementAction, 'read' | 'delete'>;
type SingleJobMutator = (id: string) => Promise<PersistedJob | null>;
type DeleteJobMutator = (id: string) => Promise<boolean>;

export function createManagementOperations<TContext = unknown>(
	options: ManagementOptions<TContext>,
) {
	return {
		getHealth: () => toSchedulerHealthDto(options.monque.isHealthy()),
		getCapabilities: (context: TContext) => getManagementCapabilities(options, context),
		listQueueViews: async (context: TContext) => {
			await requireReadAuthorization(options, context);

			return toQueueViewSummaryListDto(await options.monque.getQueueViewSummaries());
		},
		listJobs: async (input: JobListQueryDto, context: TContext) => {
			await requireReadAuthorization(options, context);

			const cursorOptions = toJobCursorOptions(input);

			if ('error' in cursorOptions) {
				throw new ORPCError('BAD_REQUEST', { message: cursorOptions.error });
			}

			try {
				return await toJobCursorPageDto(
					options,
					await options.monque.getJobsWithCursor(cursorOptions),
					context,
				);
			} catch (error) {
				if (error instanceof InvalidCursorError) {
					throw new ORPCError('BAD_REQUEST', { message: error.message });
				}

				throw error;
			}
		},
		getJobStats: async (input: { name?: string | undefined }, context: TContext) => {
			await requireReadAuthorization(options, context);

			return toQueueStatsDto(
				await options.monque.getQueueStats(
					input.name === undefined ? undefined : { name: input.name },
				),
			);
		},
		getJob: async (input: JobDetailInputDto, context: TContext) => {
			await requireReadAuthorization(options, context);

			const id = parseObjectId(input.params.id);

			if ('error' in id) {
				throw new ORPCError('BAD_REQUEST', { message: id.error });
			}

			const job = await options.monque.getJob(id.value);

			if (!job) {
				throw new ORPCError('NOT_FOUND', { message: 'Job not found' });
			}

			return toJobDto(options, job, context);
		},
		cancelJob: (input: JobDetailInputDto, context: TContext) =>
			handleSingleJobMutation(
				options,
				'cancel',
				input.params.id,
				context,
				options.monque.cancelJob?.bind(options.monque),
			),
		retryJob: (input: JobDetailInputDto, context: TContext) =>
			handleSingleJobMutation(
				options,
				'retry',
				input.params.id,
				context,
				options.monque.retryJob?.bind(options.monque),
			),
		rescheduleJob: (input: RescheduleJobInputDto, context: TContext) => {
			const rescheduleJob = options.monque.rescheduleJob?.bind(options.monque);
			let mutate: SingleJobMutator | undefined;

			if (rescheduleJob !== undefined) {
				mutate = (id) => rescheduleJob(id, new Date(input.body.nextRunAt));
			}

			return handleSingleJobMutation(options, 'reschedule', input.params.id, context, mutate);
		},
		deleteJob: (input: JobDetailInputDto, context: TContext) =>
			handleDeleteJob(
				options,
				input.params.id,
				context,
				options.monque.deleteJob?.bind(options.monque),
			),
		cancelJobs: (input: JobSelectorDto, context: TContext) =>
			handleBulkJobMutation(
				options,
				'cancel',
				input,
				context,
				options.monque.cancelJobs?.bind(options.monque),
			),
		retryJobs: (input: JobSelectorDto, context: TContext) =>
			handleBulkJobMutation(
				options,
				'retry',
				input,
				context,
				options.monque.retryJobs?.bind(options.monque),
			),
		deleteJobs: (input: JobSelectorDto, context: TContext) =>
			handleBulkJobMutation(
				options,
				'delete',
				input,
				context,
				options.monque.deleteJobs?.bind(options.monque),
			),
	};
}

async function handleSingleJobMutation<TContext>(
	options: ManagementOptions<TContext>,
	action: SingleJobMutationAction,
	idInput: string,
	context: TContext,
	mutate: SingleJobMutator | undefined,
) {
	const supportedMutate = requireMutationSupport(options, action, mutate);
	const id = await resolveSingleJobTarget(options, action, idInput, context);
	const job = await mapJobStateConflict(() => supportedMutate(id));

	if (!job) {
		throw new ORPCError('NOT_FOUND', { message: 'Job not found' });
	}

	return toJobDto(options, job, context);
}

async function handleDeleteJob<TContext>(
	options: ManagementOptions<TContext>,
	idInput: string,
	context: TContext,
	mutate: DeleteJobMutator | undefined,
) {
	const supportedMutate = requireMutationSupport(options, 'delete', mutate);
	const id = await resolveSingleJobTarget(options, 'delete', idInput, context);
	const deleted = await supportedMutate(id);

	if (!deleted) {
		throw new ORPCError('NOT_FOUND', { message: 'Job not found' });
	}

	return toDeleteJobDto();
}

function requireMutationSupport<TContext, TMutator>(
	options: ManagementOptions<TContext>,
	action: Exclude<ManagementAction, 'read'>,
	mutate: TMutator | undefined,
): TMutator {
	const decision = decideManagementActionSupport(options, action, mutate !== undefined);

	if (!decision.allowed) {
		throwForbidden(decision.message);
	}

	if (mutate === undefined) {
		throwForbidden('Unsupported action');
	}

	return mutate;
}

async function resolveSingleJobTarget<TContext>(
	options: ManagementOptions<TContext>,
	action: Exclude<ManagementAction, 'read'>,
	idInput: string,
	context: TContext,
): Promise<string> {
	const id = parseObjectId(idInput);

	if ('error' in id) {
		throw new ORPCError('BAD_REQUEST', { message: id.error });
	}

	const target = await options.monque.getJob(id.value);

	if (!target) {
		throw new ORPCError('NOT_FOUND', { message: 'Job not found' });
	}

	await requireManagementAction(options, action, context, { job: target });

	return id.value.toHexString();
}

async function handleBulkJobMutation<TContext>(
	options: ManagementOptions<TContext>,
	action: BulkManagementAction,
	input: JobSelectorDto,
	context: TContext,
	mutate: BulkJobMutator | undefined,
) {
	const supportedMutate = requireMutationSupport(options, action, mutate);
	const selector = toJobSelector(input);

	await requireManagementAction(options, action, context, { selector });

	return toBulkActionResultDto(await mapJobStateConflict(() => supportedMutate(selector)));
}

async function requireReadAuthorization<TContext>(
	options: ManagementOptions<TContext>,
	context: TContext,
): Promise<void> {
	await requireManagementAction(options, 'read', context);
}

async function requireManagementAction<TContext>(
	options: ManagementOptions<TContext>,
	action: ManagementAction,
	context: TContext,
	target: ManagementActionTarget = {},
): Promise<void> {
	const decision = await decideManagementAction(options, action, context, target);

	if (!decision.allowed) {
		throwForbidden(decision.message);
	}
}

function throwForbidden(message: string): never {
	throw new ORPCError('FORBIDDEN', { message });
}

async function mapJobStateConflict<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
	try {
		return await operation();
	} catch (error) {
		if (error instanceof JobStateError) {
			throw new ORPCError('CONFLICT', { message: error.message });
		}

		throw error;
	}
}
