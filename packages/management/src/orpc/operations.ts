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
	toJobSummaryPageDto,
	toQueueStatsDto,
	toQueueViewSummaryListDto,
	toSchedulerHealthDto,
} from '../mappers/index.js';
import type {
	BulkActionResultDto,
	CapabilitiesDto,
	DeleteJobDto,
	JobCursorPageDto,
	JobDetailInputDto,
	JobDto,
	JobListQueryDto,
	JobSelectorDto,
	QueueStatsDto,
	QueueViewSummaryListDto,
	RescheduleJobInputDto,
	SchedulerHealthDto,
	SelectedJobActionsDto,
} from '../schemas/index.js';
import {
	decideManagementAction,
	decideManagementActionSupport,
	getManagementCapabilities,
	isManagementActionSupported,
	type ManagementActionTarget,
} from '../surface/action-policy.js';
import type { ManagementAction, ManagementOptions } from '../surface/index.js';
import {
	parseObjectId,
	toJobCursorOptions,
	toJobSelector,
	toQueueStatsFilter,
} from '../surface/request-mapping.js';

type BulkManagementAction = 'cancelBulk' | 'retryBulk' | 'deleteBulk';
type BulkJobMutator = (selector: JobSelector) => Promise<BulkOperationResult>;
type SingleJobMutationInput =
	| { action: 'cancel' | 'retry' }
	| { action: 'reschedule'; nextRunAt: string };
type SingleJobMutator = (id: string) => Promise<PersistedJob | null>;

export interface ManagementOperations<TContext = unknown> {
	getHealth(): SchedulerHealthDto;
	selectedJobActions(input: SelectedJobActionsDto, context: TContext): Promise<BulkActionResultDto>;
	getCapabilities(context: TContext): Promise<CapabilitiesDto>;
	listQueueViews(context: TContext): Promise<QueueViewSummaryListDto>;
	listJobs(input: JobListQueryDto, context: TContext): Promise<JobCursorPageDto>;
	getJobStats(input: { name?: string | undefined }, context: TContext): Promise<QueueStatsDto>;
	getJob(input: JobDetailInputDto, context: TContext): Promise<JobDto>;
	cancelJob(input: JobDetailInputDto, context: TContext): Promise<JobDto>;
	retryJob(input: JobDetailInputDto, context: TContext): Promise<JobDto>;
	rescheduleJob(input: RescheduleJobInputDto, context: TContext): Promise<JobDto>;
	deleteJob(input: JobDetailInputDto, context: TContext): Promise<DeleteJobDto>;
	cancelJobs(input: JobSelectorDto, context: TContext): Promise<BulkActionResultDto>;
	retryJobs(input: JobSelectorDto, context: TContext): Promise<BulkActionResultDto>;
	deleteJobs(input: JobSelectorDto, context: TContext): Promise<BulkActionResultDto>;
}

export function createManagementOperations<TContext = unknown>(
	options: ManagementOptions<TContext>,
): ManagementOperations<TContext> {
	return {
		selectedJobActions: (input, context) => handleSelectedJobActions(options, input, context),
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
				if (input.view === 'summary') {
					const page = options.monque.getJobSummariesWithCursor
						? await options.monque.getJobSummariesWithCursor(cursorOptions)
						: await options.monque.getJobsWithCursor(cursorOptions);
					return toJobSummaryPageDto(page);
				}
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

			return toQueueStatsDto(await options.monque.getQueueStats(toQueueStatsFilter(input)));
		},
		getJob: async (input: JobDetailInputDto, context: TContext) => {
			await requireReadAuthorization(options, context);

			const { job } = await resolvePersistedJob(options, input.params.id);

			return toJobDto(options, job, context);
		},
		cancelJob: async (input: JobDetailInputDto, context: TContext) =>
			toJobDto(
				options,
				await executeJobMutation(options, { action: 'cancel' }, input.params.id, context),
				context,
			),
		retryJob: async (input: JobDetailInputDto, context: TContext) =>
			toJobDto(
				options,
				await executeJobMutation(options, { action: 'retry' }, input.params.id, context),
				context,
			),
		rescheduleJob: async (input: RescheduleJobInputDto, context: TContext) =>
			toJobDto(
				options,
				await executeJobMutation(
					options,
					{ action: 'reschedule', nextRunAt: input.body.nextRunAt },
					input.params.id,
					context,
				),
				context,
			),
		deleteJob: async (input: JobDetailInputDto, context: TContext) => {
			await executeJobDeletion(options, input.params.id, context);
			return toDeleteJobDto();
		},
		cancelJobs: (input: JobSelectorDto, context: TContext) =>
			handleBulkJobMutation(
				options,
				'cancelBulk',
				input,
				context,
				options.monque.cancelJobs?.bind(options.monque),
			),
		retryJobs: (input: JobSelectorDto, context: TContext) =>
			handleBulkJobMutation(
				options,
				'retryBulk',
				input,
				context,
				options.monque.retryJobs?.bind(options.monque),
			),
		deleteJobs: (input: JobSelectorDto, context: TContext) =>
			handleBulkJobMutation(
				options,
				'deleteBulk',
				input,
				context,
				options.monque.deleteJobs?.bind(options.monque),
			),
	};
}

async function executeJobMutation<TContext>(
	options: ManagementOptions<TContext>,
	input: SingleJobMutationInput,
	idInput: string,
	context: TContext,
): Promise<PersistedJob> {
	const mutate =
		input.action === 'reschedule'
			? toRescheduleJobMutator(options, new Date(input.nextRunAt))
			: input.action === 'retry'
				? options.monque.retryJob?.bind(options.monque)
				: options.monque.cancelJob?.bind(options.monque);
	const supportedMutate = requireMutationSupport(options, input.action, mutate);
	const id = await resolveSingleJobTarget(options, input.action, idInput, context);
	const job = await mapJobStateConflict(() => supportedMutate(id));

	if (!job) {
		throw new ORPCError('NOT_FOUND', { message: 'Job not found' });
	}

	return job;
}

async function executeJobDeletion<TContext>(
	options: ManagementOptions<TContext>,
	idInput: string,
	context: TContext,
): Promise<void> {
	const supportedMutate = requireMutationSupport(
		options,
		'delete',
		options.monque.deleteJob?.bind(options.monque),
	);
	const id = await resolveSingleJobTarget(options, 'delete', idInput, context);
	const deleted = await supportedMutate(id);

	if (!deleted) {
		throw new ORPCError('NOT_FOUND', { message: 'Job not found' });
	}
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

function toRescheduleJobMutator<TContext>(
	options: ManagementOptions<TContext>,
	runAt: Date,
): SingleJobMutator | undefined {
	const rescheduleJob = options.monque.rescheduleJob?.bind(options.monque);

	if (rescheduleJob === undefined) {
		return undefined;
	}

	return (id) => rescheduleJob(id, runAt);
}

async function resolveSingleJobTarget<TContext>(
	options: ManagementOptions<TContext>,
	action: Exclude<ManagementAction, 'read'>,
	idInput: string,
	context: TContext,
): Promise<string> {
	const { id, job } = await resolvePersistedJob(options, idInput);

	await requireManagementAction(options, action, context, { job });

	return id.toHexString();
}

async function resolvePersistedJob<TContext>(
	options: ManagementOptions<TContext>,
	idInput: string,
): Promise<{ id: PersistedJob['_id']; job: PersistedJob }> {
	const id = parseObjectId(idInput);

	if ('error' in id) {
		throw new ORPCError('BAD_REQUEST', { message: id.error });
	}

	const target = await options.monque.getJob(idInput);

	if (!target) {
		throw new ORPCError('NOT_FOUND', { message: 'Job not found' });
	}

	return { id: id.value, job: target };
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

async function handleSelectedJobActions<TContext>(
	options: ManagementOptions<TContext>,
	input: SelectedJobActionsDto,
	context: TContext,
): Promise<BulkActionResultDto> {
	const capability =
		input.action === 'reschedule' ? 'reschedule' : (`${input.action}Bulk` as const);
	if (!isManagementActionSupported(options.monque, capability))
		throwForbidden('Unsupported action');
	const ids = [
		...new Set(input.ids.map((id) => (/^[a-fA-F0-9]{24}$/.test(id) ? id.toLowerCase() : id))),
	];
	await requireManagementAction(options, capability, context, { ids });
	const result: BulkActionResultDto = { count: 0, errors: [] };
	for (let offset = 0; offset < ids.length; offset += 5) {
		await Promise.all(
			ids.slice(offset, offset + 5).map(async (id) => {
				try {
					if (input.action === 'delete') {
						await executeJobDeletion(options, id, context);
					} else {
						await executeJobMutation(
							options,
							input.action === 'reschedule' ? input : { action: input.action },
							id,
							context,
						);
					}
					result.count++;
				} catch (error) {
					result.errors.push({
						jobId: id,
						status: error instanceof ORPCError ? error.status : 500,
						error: error instanceof ORPCError ? error.message : 'Job action failed',
					});
				}
			}),
		);
	}
	return result;
}
