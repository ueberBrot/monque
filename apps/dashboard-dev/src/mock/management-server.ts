import {
	type BulkActionResultDto,
	type JobCursorPageDto,
	type JobDto,
	type JobListQueryDto,
	type JobSelectorDto,
	managementContract,
} from '@monque/management/contract';
import { OpenAPIHandler } from '@orpc/openapi/fetch';
import { implement, ORPCError } from '@orpc/server';

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
const DEFAULT_SCENARIO_ID: DashboardDevScenarioId = 'pending-jobs';

type MutableScenario = Omit<DashboardDevScenario, 'jobs'> & { jobs: JobDto[] };

function createMockManagementOpenApiHandler(): OpenAPIHandler<MockManagementContext> {
	const scenarios = new Map<DashboardDevScenarioId, MutableScenario>();
	function getReadableScenario(context: MockManagementContext): MutableScenario {
		let scenario = scenarios.get(context.scenarioId);
		if (!scenario) {
			const source = getScenarioOrThrow(context);
			scenario = { ...source, jobs: source.jobs.map((job) => ({ ...job })) };
			scenarios.set(context.scenarioId, scenario);
		}
		assertScenarioResponseAllowed(scenario);
		return scenario;
	}
	const mockManagementRouter = managementImplementer.router({
		health: managementImplementer.health.handler(
			({ context }) => getReadableScenario(context).health,
		),
		capabilities: managementImplementer.capabilities.handler(
			({ context }) => getReadableScenario(context).capabilities,
		),
		queueViews: managementImplementer.queueViews.handler(({ context }) => ({
			queueViews: getReadableScenario(context)
				.queueViews.map((view) => ({
					...view,
					stats: createQueueStats(
						getReadableScenario(context).jobs.filter((job) => job.name === view.name),
					),
					hasPersistedJobs: getReadableScenario(context).jobs.some((job) => job.name === view.name),
				}))
				.filter((view) => view.hasPersistedJobs || view.hasRegisteredWorker),
		})),
		jobs: managementImplementer.jobs.handler(({ input, context }) =>
			listJobs(input, getReadableScenario(context)),
		),
		jobStats: managementImplementer.jobStats.handler(({ input, context }) => {
			const scenario = getReadableScenario(context);
			const jobs = input.name
				? scenario.jobs.filter((job) => job.name === input.name)
				: scenario.jobs;

			return createQueueStats(jobs);
		}),
		job: managementImplementer.job.handler(({ input, context }) =>
			getJobById(input.params.id, getReadableScenario(context)),
		),
		cancelJob: managementImplementer.cancelJob.handler(({ input, context }) =>
			mutateSingleJob(input.params.id, getReadableScenario(context), 'cancel', (job, now) => ({
				...job,
				status: 'cancelled',
				claimedBy: null,
				lockedAt: null,
				lastHeartbeat: null,
				updatedAt: now,
			})),
		),
		retryJob: managementImplementer.retryJob.handler(({ input, context }) =>
			mutateSingleJob(input.params.id, getReadableScenario(context), 'retry', retryJob),
		),
		rescheduleJob: managementImplementer.rescheduleJob.handler(({ input, context }) =>
			mutateSingleJob(input.params.id, getReadableScenario(context), 'reschedule', (job, now) => ({
				...job,
				status: 'pending',
				nextRunAt: input.body.nextRunAt,
				claimedBy: null,
				lockedAt: null,
				lastHeartbeat: null,
				updatedAt: now,
			})),
		),
		deleteJob: managementImplementer.deleteJob.handler(({ input, context }) => {
			const scenario = getReadableScenario(context);

			assertMutationAllowed(scenario);
			assertJobExists(input.params.id, scenario);
			scenario.jobs = scenario.jobs.filter((job) => job.id !== input.params.id);

			return { deleted: true };
		}),
		cancelJobs: managementImplementer.cancelJobs.handler(({ input, context }) =>
			mutateBulkJobs(input, getReadableScenario(context), 'cancel'),
		),
		retryJobs: managementImplementer.retryJobs.handler(({ input, context }) =>
			mutateBulkJobs(input, getReadableScenario(context), 'retry'),
		),
		deleteJobs: managementImplementer.deleteJobs.handler(({ input, context }) =>
			mutateBulkJobs(input, getReadableScenario(context), 'delete'),
		),
	});

	return new OpenAPIHandler(mockManagementRouter, {
		customErrorResponseBodyEncoder: (error: ORPCError<string, unknown>) =>
			typeof error.data === 'object' && error.data !== null ? error.data : { error: error.message },
	});
}

function createMockManagementFetch(options?: {
	readonly scenarioId?: DashboardDevScenarioId;
}): typeof fetch {
	const handler = createMockManagementOpenApiHandler();
	const scenarioId = options?.scenarioId ?? DEFAULT_SCENARIO_ID;

	return async (input, init) => {
		const request = new Request(input, init);
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

function assertScenarioResponseAllowed(scenario: DashboardDevScenario): void {
	if (scenario.apiError) {
		throw new ORPCError('INTERNAL_SERVER_ERROR', {
			data: { error: scenario.apiError },
			message: scenario.apiError,
		});
	}

	if (scenario.unauthorized) {
		throw new ORPCError('UNAUTHORIZED', {
			data: { error: 'Sign in to inspect the dashboard scenario.' },
			message: 'Sign in to inspect the dashboard scenario.',
		});
	}

	if (scenario.forbidden) {
		throw new ORPCError('FORBIDDEN', {
			data: { error: 'You do not have access to this dashboard scenario.' },
			message: 'You do not have access to this dashboard scenario.',
		});
	}
}

function listJobs(input: JobListQueryDto, scenario: DashboardDevScenario): JobCursorPageDto {
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
	scenario: MutableScenario,
	action: 'cancel' | 'retry' | 'reschedule',
	transform: (job: JobDto, now: string) => JobDto,
): JobDto {
	assertMutationAllowed(scenario);
	const job = getJobById(id, scenario);

	if (!scenario.capabilities.actions[action]) throw new ORPCError('FORBIDDEN');
	if (action === 'cancel' && job.status === 'cancelled') return job;
	if (
		(action === 'retry' && job.status !== 'failed' && job.status !== 'cancelled') ||
		(action !== 'retry' && job.status !== 'pending')
	)
		throw new ORPCError('CONFLICT', {
			message: 'Job state changed before the mutation completed.',
		});
	const updated = transform(job, new Date().toISOString());
	scenario.jobs = scenario.jobs.map((candidate) => (candidate.id === id ? updated : candidate));
	return updated;
}

function mutateBulkJobs(
	input: JobSelectorDto,
	scenario: MutableScenario,
	action: 'cancel' | 'retry' | 'delete',
): BulkActionResultDto {
	assertMutationAllowed(scenario);

	const jobs = scenario.jobs.filter((job) => matchesJobSelector(job, input));

	const eligible = jobs.filter(
		(job) =>
			action === 'delete' ||
			(action === 'cancel'
				? job.status === 'pending'
				: job.status === 'failed' || job.status === 'cancelled'),
	);
	const ids = new Set(eligible.map((job) => job.id));
	const now = new Date().toISOString();
	scenario.jobs =
		action === 'delete'
			? scenario.jobs.filter((job) => !ids.has(job.id))
			: scenario.jobs.map((job) =>
					ids.has(job.id)
						? action === 'retry'
							? retryJob(job, now)
							: { ...job, status: 'cancelled', updatedAt: now }
						: job,
				);

	return {
		count: eligible.length,
		errors: [],
	};
}

function retryJob(job: JobDto, now: string): JobDto {
	return {
		...job,
		status: 'pending',
		failCount: 0,
		failureReason: null,
		claimedBy: null,
		lockedAt: null,
		lastHeartbeat: null,
		nextRunAt: now,
		updatedAt: now,
	};
}

function applyJobFilters(jobs: readonly JobDto[], input: JobListQueryDto): readonly JobDto[] {
	return jobs.filter(
		(job) =>
			matchesJobName(job, input.name) &&
			matchesJobStatus(job, input.status) &&
			matchesDateRange(job.createdAt, input.createdAtFrom, input.createdAtTo) &&
			matchesDateRange(job.updatedAt, input.updatedAtFrom, input.updatedAtTo) &&
			matchesDateRange(job.nextRunAt, input.nextRunAtFrom, input.nextRunAtTo),
	);
}

function matchesJobSelector(job: JobDto, input: JobSelectorDto): boolean {
	return (
		matchesJobName(job, input.name) &&
		matchesJobStatus(job, input.status) &&
		matchesExclusiveUpperDateBound(job.createdAt, input.olderThan) &&
		matchesExclusiveLowerDateBound(job.createdAt, input.newerThan)
	);
}

function matchesJobName(job: JobDto, name: string | undefined): boolean {
	return !name || job.name === name;
}

function matchesJobStatus(
	job: JobDto,
	status: JobListQueryDto['status'] | JobSelectorDto['status'],
): boolean {
	const statuses = normalizeStatusFilter(status);
	return !statuses || statuses.includes(job.status);
}

function normalizeStatusFilter(
	status: JobListQueryDto['status'] | JobSelectorDto['status'],
): readonly JobDto['status'][] | undefined {
	if (!status) {
		return undefined;
	}

	return Array.isArray(status) ? status : [status];
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

function matchesExclusiveUpperDateBound(value: string, upperBound?: string): boolean {
	if (!upperBound) {
		return true;
	}

	return Date.parse(value) < Date.parse(upperBound);
}

function matchesExclusiveLowerDateBound(value: string, lowerBound?: string): boolean {
	if (!lowerBound) {
		return true;
	}

	return Date.parse(value) > Date.parse(lowerBound);
}

function sortJobs(
	jobs: readonly JobDto[],
	sortBy: JobListQueryDto['sortBy'],
	sortDirection: JobListQueryDto['sortDirection'],
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

function getSortAccessor(sortBy: JobListQueryDto['sortBy']): (job: JobDto) => string {
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
		const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
		const offset = getCursorOffset(parsed);

		return offset ?? 0;
	} catch {
		return 0;
	}
}

function getCursorOffset(value: unknown): number | undefined {
	if (typeof value !== 'object' || value === null || !Object.hasOwn(value, 'offset')) {
		return undefined;
	}

	const offset = Reflect.get(value, 'offset');
	return typeof offset === 'number' && offset >= 0 ? offset : undefined;
}

function assertMutationAllowed(scenario: DashboardDevScenario): void {
	if (scenario.capabilities.readOnly)
		throw new ORPCError('FORBIDDEN', { message: 'This Management API is read-only.' });
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
