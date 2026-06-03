import { OpenAPIHandler } from '@orpc/openapi/fetch';
import { implement, ORPCError } from '@orpc/server';

import {
	type JobDto,
	type JobListQueryDto,
	type JobSelectorDto,
	managementContract,
} from '../../../../packages/management/src/contract.ts';
import {
	createQueueStats,
	type DashboardDevScenario,
	type DashboardDevScenarioId,
	getDashboardDevScenario,
} from './scenario-catalog.js';

type MockManagementContext = {
	readonly scenarioId: DashboardDevScenarioId;
};

const managementImplementer = implement(managementContract).$context<MockManagementContext>();

const mockManagementRouter = managementImplementer.router({
	health: managementImplementer.health.handler(({ context }) => getScenarioOrThrow(context).health),
	capabilities: managementImplementer.capabilities.handler(
		({ context }) => getAuthorizedScenario(context).capabilities,
	),
	queueViews: managementImplementer.queueViews.handler(({ context }) => ({
		queueViews: [...getAuthorizedScenario(context).queueViews],
	})),
	jobs: managementImplementer.jobs.handler(({ input, context }) =>
		listJobs(input, getAuthorizedScenario(context)),
	),
	jobStats: managementImplementer.jobStats.handler(({ input, context }) => {
		const scenario = getAuthorizedScenario(context);
		const jobs = input.name
			? scenario.jobs.filter((job) => job.name === input.name)
			: scenario.jobs;

		return createQueueStats(jobs);
	}),
	job: managementImplementer.job.handler(({ input, context }) =>
		getJobById(input.params.id, getAuthorizedScenario(context)),
	),
	cancelJob: managementImplementer.cancelJob.handler(({ input, context }) =>
		mutateSingleJob(input.params.id, getAuthorizedScenario(context), (job) => ({
			...job,
			status: 'cancelled',
			claimedBy: null,
			lockedAt: null,
			lastHeartbeat: null,
			updatedAt: new Date('2026-06-03T12:00:00.000Z').toISOString(),
		})),
	),
	retryJob: managementImplementer.retryJob.handler(({ input, context }) =>
		mutateSingleJob(input.params.id, getAuthorizedScenario(context), (job) => ({
			...job,
			status: 'pending',
			failCount: 0,
			failureReason: null,
			claimedBy: null,
			lockedAt: null,
			lastHeartbeat: null,
			updatedAt: new Date('2026-06-03T12:00:00.000Z').toISOString(),
		})),
	),
	rescheduleJob: managementImplementer.rescheduleJob.handler(({ input, context }) =>
		mutateSingleJob(input.params.id, getAuthorizedScenario(context), (job) => ({
			...job,
			status: 'pending',
			nextRunAt: input.body.nextRunAt,
			claimedBy: null,
			lockedAt: null,
			lastHeartbeat: null,
			updatedAt: new Date('2026-06-03T12:00:00.000Z').toISOString(),
		})),
	),
	deleteJob: managementImplementer.deleteJob.handler(({ input, context }) => {
		assertMutationAllowed(getAuthorizedScenario(context));
		assertJobExists(input.params.id, getAuthorizedScenario(context));

		return { deleted: true };
	}),
	cancelJobs: managementImplementer.cancelJobs.handler(({ input, context }) =>
		mutateBulkJobs(input, getAuthorizedScenario(context)),
	),
	retryJobs: managementImplementer.retryJobs.handler(({ input, context }) =>
		mutateBulkJobs(input, getAuthorizedScenario(context)),
	),
	deleteJobs: managementImplementer.deleteJobs.handler(({ input, context }) =>
		mutateBulkJobs(input, getAuthorizedScenario(context)),
	),
});

function createMockManagementOpenApiHandler(): OpenAPIHandler<MockManagementContext> {
	return new OpenAPIHandler(mockManagementRouter, {
		customErrorResponseBodyEncoder: (error: ORPCError<string, unknown>) =>
			typeof error.data === 'object' && error.data !== null ? error.data : { error: error.message },
	});
}

function createMockManagementFetch(options?: {
	readonly scenarioId?: DashboardDevScenarioId;
}): typeof fetch {
	const handler = createMockManagementOpenApiHandler();
	const scenarioId = options?.scenarioId ?? 'pending-jobs';

	return async (input, init) => {
		const request = input instanceof Request ? input : new Request(input, init);
		const result = await handler.handle(request, {
			context: { scenarioId },
		});

		if (!result.matched) {
			return new Response(JSON.stringify({ error: 'Route not found' }), {
				status: 404,
				headers: { 'content-type': 'application/json' },
			});
		}

		return result.response;
	};
}

function getScenarioOrThrow(context: MockManagementContext): DashboardDevScenario {
	const scenario = getDashboardDevScenario(context.scenarioId);

	if (!scenario) {
		throw new ORPCError('NOT_FOUND', {
			data: { error: `Unknown dashboard dev scenario: ${context.scenarioId}` },
			message: `Unknown dashboard dev scenario: ${context.scenarioId}`,
		});
	}

	return scenario;
}

function getAuthorizedScenario(context: MockManagementContext): DashboardDevScenario {
	const scenario = getScenarioOrThrow(context);

	if (scenario.unauthorized) {
		throw new ORPCError('UNAUTHORIZED', {
			data: { error: 'Sign in to inspect the dashboard scenario.' },
			message: 'Sign in to inspect the dashboard scenario.',
		});
	}

	return scenario;
}

function listJobs(input: JobListQueryDto, scenario: DashboardDevScenario) {
	const filteredJobs = applyJobFilters(scenario.jobs, input);
	const sortedJobs = sortJobs(filteredJobs, input.sortBy, input.sortDirection);
	const pageSize = normalizeLimit(input.limit);
	const startIndex = decodeCursor(input.cursor);
	const pageJobs = sortedJobs.slice(startIndex, startIndex + pageSize);
	const nextIndex = startIndex + pageSize;

	return {
		jobs: pageJobs,
		cursor: nextIndex < sortedJobs.length ? encodeCursor(nextIndex) : null,
		hasNextPage: nextIndex < sortedJobs.length,
		hasPreviousPage: startIndex > 0,
	};
}

function getJobById(id: string, scenario: DashboardDevScenario): JobDto {
	const job = scenario.jobs.find((candidate) => candidate.id === id);

	if (!job) {
		throw new ORPCError('NOT_FOUND', {
			data: { error: 'Job not found' },
			message: 'Job not found',
		});
	}

	return { ...job };
}

function mutateSingleJob(
	id: string,
	scenario: DashboardDevScenario,
	transform: (job: JobDto) => JobDto,
): JobDto {
	assertMutationAllowed(scenario);
	return transform(getJobById(id, scenario));
}

function mutateBulkJobs(input: JobSelectorDto, scenario: DashboardDevScenario) {
	assertMutationAllowed(scenario);

	const jobs = scenario.jobs.filter((job) => {
		if (input.name && job.name !== input.name) {
			return false;
		}

		if (input.status) {
			const statuses = Array.isArray(input.status) ? input.status : [input.status];

			if (!statuses.includes(job.status)) {
				return false;
			}
		}

		if (input.olderThan && Date.parse(job.createdAt) >= Date.parse(input.olderThan)) {
			return false;
		}

		if (input.newerThan && Date.parse(job.createdAt) <= Date.parse(input.newerThan)) {
			return false;
		}

		return true;
	});

	return {
		count: jobs.length,
		errors: [],
	};
}

function applyJobFilters(jobs: readonly JobDto[], input: JobListQueryDto): readonly JobDto[] {
	return jobs.filter((job) => {
		if (input.name && job.name !== input.name) {
			return false;
		}

		if (input.status) {
			const statuses = Array.isArray(input.status) ? input.status : [input.status];

			if (!statuses.includes(job.status)) {
				return false;
			}
		}

		return (
			matchesDateRange(job.createdAt, input.createdAtFrom, input.createdAtTo) &&
			matchesDateRange(job.updatedAt, input.updatedAtFrom, input.updatedAtTo) &&
			matchesDateRange(job.nextRunAt, input.nextRunAtFrom, input.nextRunAtTo)
		);
	});
}

function matchesDateRange(value: string, from?: string, to?: string): boolean {
	const timestamp = Date.parse(value);

	if (from && timestamp < Date.parse(from)) {
		return false;
	}

	if (to && timestamp > Date.parse(to)) {
		return false;
	}

	return true;
}

function sortJobs(
	jobs: readonly JobDto[],
	sortBy?: string,
	sortDirection?: string,
): readonly JobDto[] {
	const direction = sortDirection === 'asc' ? 1 : -1;
	const accessor = getSortAccessor(sortBy);

	return [...jobs].sort((left, right) => {
		const leftValue = accessor(left);
		const rightValue = accessor(right);

		if (leftValue < rightValue) {
			return -1 * direction;
		}

		if (leftValue > rightValue) {
			return 1 * direction;
		}

		return left.id.localeCompare(right.id) * direction;
	});
}

function getSortAccessor(sortBy?: string): (job: JobDto) => string {
	switch (sortBy) {
		case 'identifier':
			return (job) => job.id;
		case 'updatedAt':
			return (job) => job.updatedAt;
		case 'nextRunAt':
			return (job) => job.nextRunAt;
		default:
			return (job) => job.createdAt;
	}
}

function normalizeLimit(limit?: string): number {
	const parsed = Number.parseInt(limit ?? '50', 10);

	if (Number.isNaN(parsed) || parsed <= 0) {
		return 50;
	}

	return Math.min(parsed, 100);
}

function encodeCursor(offset: number): string {
	return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url');
}

function decodeCursor(cursor?: string): number {
	if (!cursor) {
		return 0;
	}

	try {
		const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
			offset?: unknown;
		};

		return typeof parsed.offset === 'number' && parsed.offset >= 0 ? parsed.offset : 0;
	} catch {
		return 0;
	}
}

function assertMutationAllowed(scenario: DashboardDevScenario): void {
	if (scenario.mutationConflict) {
		throw new ORPCError('CONFLICT', {
			data: { error: 'Job state changed before the mutation completed.' },
			message: 'Job state changed before the mutation completed.',
		});
	}
}

function assertJobExists(id: string, scenario: DashboardDevScenario): void {
	const job = scenario.jobs.find((candidate) => candidate.id === id);

	if (!job) {
		throw new ORPCError('NOT_FOUND', {
			data: { error: 'Job not found' },
			message: 'Job not found',
		});
	}
}

export { createMockManagementFetch, createMockManagementOpenApiHandler };
