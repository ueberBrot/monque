import { InvalidCursorError } from '@monque/core';
import { implement, ORPCError } from '@orpc/server';

import {
	toJobCursorPageDto,
	toJobDto,
	toQueueStatsDto,
	toQueueViewSummaryListDto,
	toSchedulerHealthDto,
} from '../dtos/index.js';
import type { JobListQueryDto } from '../schemas/index.js';
import { getManagementCapabilities } from '../surface/capabilities.js';
import type {
	ManagementAction,
	ManagementOpenApiContext,
	ManagementOptions,
	ManagementQueryValue,
} from '../surface/index.js';
import { parseJobListQuery, parseObjectId } from '../validation/index.js';
import { managementContract } from './contract.js';

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

			const id = parseObjectId(input.id);

			if ('error' in id) {
				throw new ORPCError('BAD_REQUEST', { message: id.error });
			}

			const job = await options.monque.getJob(id.value);

			if (!job) {
				throw new ORPCError('NOT_FOUND', { message: 'Job not found' });
			}

			return toJobDto(options, job, context.managementContext as TContext);
		}),
	});
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
): Promise<boolean> {
	if (!options.authorize) {
		return true;
	}

	return options.authorize({ action, context });
}
