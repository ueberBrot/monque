import {
	type BulkActionResultDto,
	type JobCursorPageDto,
	type JobDto,
	type JobListQueryDto,
	JobListSortByDtoSchema,
	JobListSortDirectionDtoSchema,
	type JobSelectorDto,
	managementContract,
} from '@monque/management/contract';
import { OpenAPIHandler } from '@orpc/openapi/fetch';
import { implement, ORPCError } from '@orpc/server';
import { z } from 'zod';

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

type JobMutation =
	| { readonly action: 'cancel' | 'retry' }
	| { readonly action: 'reschedule'; readonly nextRunAt: string };

type MutationCapability = Exclude<keyof DashboardDevScenario['capabilities']['actions'], 'read'>;

type MutableScenario = Omit<DashboardDevScenario, 'jobs'> & { jobs: JobDto[] };

const MockCursorSchema = z
	.strictObject({
		id: z.string().min(1),
		value: z.string().min(1),
		sortBy: JobListSortByDtoSchema,
		sortDirection: JobListSortDirectionDtoSchema,
	})
	.refine((cursor) =>
		cursor.sortBy === 'identifier'
			? cursor.value === cursor.id
			: z.iso.datetime().safeParse(cursor.value).success,
	);
type MockCursor = z.infer<typeof MockCursorSchema>;

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
		selectedJobActions: managementImplementer.selectedJobActions.handler(({ input, context }) => {
			const scenario = getReadableScenario(context);
			const capability =
				input.action === 'reschedule' ? 'reschedule' : (`${input.action}Bulk` as const);
			assertMutationAllowed(scenario, capability);
			const result: BulkActionResultDto = { count: 0, errors: [] };
			for (const id of new Set(input.ids)) {
				try {
					if (input.action === 'delete') deleteSingleJob(id, scenario);
					else {
						mutateSingleJob(
							id,
							scenario,
							input.action === 'reschedule' ? input : { action: input.action },
						);
					}
					result.count++;
				} catch (error) {
					result.errors.push({
						jobId: id,
						error: error instanceof Error ? error.message : 'Job action failed',
						status: error instanceof ORPCError ? error.status : 500,
					});
				}
			}
			return result;
		}),
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
			mutateSingleJob(input.params.id, getReadableScenario(context), { action: 'cancel' }),
		),
		retryJob: managementImplementer.retryJob.handler(({ input, context }) =>
			mutateSingleJob(input.params.id, getReadableScenario(context), { action: 'retry' }),
		),
		rescheduleJob: managementImplementer.rescheduleJob.handler(({ input, context }) =>
			mutateSingleJob(input.params.id, getReadableScenario(context), {
				action: 'reschedule',
				nextRunAt: input.body.nextRunAt,
			}),
		),
		deleteJob: managementImplementer.deleteJob.handler(({ input, context }) =>
			deleteSingleJob(input.params.id, getReadableScenario(context)),
		),
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
	const sortBy = input.sortBy ?? 'createdAt';
	const sortDirection = input.sortDirection ?? 'desc';
	const anchor = decodeCursor(input.cursor, sortBy, sortDirection);
	const accessor = getSortAccessor(sortBy);
	const compare = (
		left: Pick<MockCursor, 'id' | 'value'>,
		right: Pick<MockCursor, 'id' | 'value'>,
	) => comparePositions(left, right) * (sortDirection === 'asc' ? 1 : -1);
	const position = (job: JobDto) => ({ id: job.id, value: accessor(job) });
	const jobs = applyJobFilters(scenario.jobs, input)
		.filter((job) => !anchor || compare(position(job), anchor) > 0)
		.sort((left, right) => compare(position(left), position(right)));
	const pageSize = normalizeLimit(input.limit);
	const pageJobs = jobs.slice(0, pageSize);
	const lastJob = pageJobs.at(-1);

	return {
		jobs: input.view === 'summary' ? pageJobs.map((job) => ({ ...job, payload: null })) : pageJobs,
		cursor: lastJob ? encodeCursor({ ...position(lastJob), sortBy, sortDirection }) : null,
		hasNextPage: jobs.length > pageSize,
		hasPreviousPage: anchor !== undefined,
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

function mutateSingleJob(id: string, scenario: MutableScenario, mutation: JobMutation): JobDto {
	const { action } = mutation;
	assertMutationAllowed(scenario, action);
	const job = getJobById(id, scenario);
	if (action === 'cancel' && job.status === 'cancelled') return job;
	if (
		(action === 'retry' && job.status !== 'failed' && job.status !== 'cancelled') ||
		(action !== 'retry' && job.status !== 'pending')
	)
		throw new ORPCError('CONFLICT', {
			message: 'Job state changed before the mutation completed.',
		});
	const updated = applyJobMutation(job, mutation, new Date().toISOString());
	scenario.jobs = scenario.jobs.map((candidate) => (candidate.id === id ? updated : candidate));
	return updated;
}

function mutateBulkJobs(
	input: JobSelectorDto,
	scenario: MutableScenario,
	action: 'cancel' | 'retry' | 'delete',
): BulkActionResultDto {
	assertMutationAllowed(scenario, `${action}Bulk`);

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
					ids.has(job.id) ? applyJobMutation(job, { action }, now) : job,
				);

	return {
		count: eligible.length,
		errors: [],
	};
}

function deleteSingleJob(id: string, scenario: MutableScenario): { deleted: true } {
	assertMutationAllowed(scenario, 'delete');
	assertJobExists(id, scenario);
	scenario.jobs = scenario.jobs.filter((job) => job.id !== id);
	return { deleted: true };
}

function applyJobMutation(job: JobDto, mutation: JobMutation, now: string): JobDto {
	const updated: JobDto = {
		...job,
		status: mutation.action === 'cancel' ? 'cancelled' : 'pending',
		claimedBy: null,
		lockedAt: null,
		lastHeartbeat: null,
		updatedAt: now,
	};
	if (mutation.action === 'retry') {
		updated.failCount = 0;
		updated.failureReason = null;
		updated.nextRunAt = now;
	} else if (mutation.action === 'reschedule') {
		updated.nextRunAt = new Date(mutation.nextRunAt).toISOString();
	}
	return updated;
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

function comparePositions(
	left: Pick<MockCursor, 'id' | 'value'>,
	right: Pick<MockCursor, 'id' | 'value'>,
): number {
	if (left.value < right.value) return -1;
	if (left.value > right.value) return 1;
	return left.id.localeCompare(right.id);
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

function encodeCursor(cursor: MockCursor): string {
	return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(
	cursor: string | undefined,
	sortBy: MockCursor['sortBy'],
	sortDirection: MockCursor['sortDirection'],
): MockCursor | undefined {
	if (!cursor) return undefined;

	let parsed: MockCursor;
	try {
		parsed = MockCursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
	} catch {
		throw new ORPCError('BAD_REQUEST', { message: 'Invalid cursor' });
	}
	if (parsed.sortBy !== sortBy || parsed.sortDirection !== sortDirection) {
		throw new ORPCError('BAD_REQUEST', { message: 'Cursor does not match requested sort' });
	}
	return parsed;
}

function assertMutationAllowed(scenario: DashboardDevScenario, action: MutationCapability): void {
	if (scenario.capabilities.readOnly)
		throw new ORPCError('FORBIDDEN', { message: 'This Management API is read-only.' });
	if (!scenario.capabilities.actions[action]) throw new ORPCError('FORBIDDEN');
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
