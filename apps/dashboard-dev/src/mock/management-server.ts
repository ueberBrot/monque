import {
  JobListSortByDtoSchema,
  JobListSortDirectionDtoSchema,
  managementContract,
} from "@monque/management/contract";
import type {
  BulkActionResultDto,
  JobCursorPageDto,
  JobDto,
  JobListQueryDto,
  JobSelectorDto,
  ProcessingActionDto,
  ProcessingStateDto,
} from "@monque/management/contract";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { implement, ORPCError } from "@orpc/server";
import { z } from "zod";

import { isObject } from "../../../../packages/dashboard/src/lib/type-guards.js";
import { createQueueStats, getDashboardDevScenario } from "./scenario-catalog.js";
import type { DashboardDevScenario, DashboardDevScenarioId } from "./scenario-catalog.js";

interface MockManagementContext {
  readonly scenarioId: DashboardDevScenarioId;
}
const managementImplementer = implement(managementContract).$context<MockManagementContext>();
const DEFAULT_SCENARIO_ID: DashboardDevScenarioId = "pending-jobs";
type JobMutation =
  | {
      readonly action: "cancel" | "retry";
    }
  | {
      readonly action: "reschedule";
      readonly nextRunAt: string;
    }
  | {
      readonly action: "priority";
      readonly priority: number;
    };
type MutationCapability = Exclude<keyof DashboardDevScenario["capabilities"]["actions"], "read">;
type MutableScenario = Omit<DashboardDevScenario, "jobs"> & {
  jobs: JobDto[];
  globallyPaused: boolean;
  pausedWorkers: Set<string>;
};
const MockCursorSchema = z
  .strictObject({
    id: z.string().min(1),
    value: z.string().min(1),
    sortBy: JobListSortByDtoSchema,
    sortDirection: JobListSortDirectionDtoSchema,
  })
  .refine((cursor) =>
    cursor.sortBy === "identifier"
      ? cursor.value === cursor.id
      : z.iso.datetime().safeParse(cursor.value).success,
  );
type MockCursor = z.infer<typeof MockCursorSchema>;
const getScenarioOrThrow = (context: MockManagementContext): DashboardDevScenario => {
  const scenario = getDashboardDevScenario(context.scenarioId);
  if (!scenario) {
    throw new ORPCError("NOT_FOUND", {
      data: { error: `Unknown dashboard dev scenario: ${context.scenarioId}` },
      message: `Unknown dashboard dev scenario: ${context.scenarioId}`,
    });
  }
  return scenario;
};
const assertScenarioResponseAllowed = (scenario: DashboardDevScenario): void => {
  if (
    !(scenario.apiError === undefined || scenario.apiError === null || scenario.apiError === "")
  ) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      data: { error: scenario.apiError },
      message: scenario.apiError,
    });
  }
  if (scenario.unauthorized === true) {
    throw new ORPCError("UNAUTHORIZED", {
      data: { error: "Sign in to inspect the dashboard scenario." },
      message: "Sign in to inspect the dashboard scenario.",
    });
  }
  if (scenario.forbidden === true) {
    throw new ORPCError("FORBIDDEN", {
      data: { error: "You do not have access to this dashboard scenario." },
      message: "You do not have access to this dashboard scenario.",
    });
  }
};
const assertMutationAllowed = (
  scenario: DashboardDevScenario,
  action: MutationCapability,
): void => {
  if (scenario.capabilities.readOnly) {
    throw new ORPCError("FORBIDDEN", { message: "This Management API is read-only." });
  }
  if (scenario.capabilities.actions[action] !== true) {
    throw new ORPCError("FORBIDDEN");
  }
  if (scenario.mutationConflict === true) {
    throw new ORPCError("CONFLICT", {
      data: { error: "Job state changed before the mutation completed." },
      message: "Job state changed before the mutation completed.",
    });
  }
};
const getJobById = (id: string, scenario: DashboardDevScenario): JobDto => {
  const job = scenario.jobs.find((candidate) => candidate.id === id);
  if (!job) {
    throw new ORPCError("NOT_FOUND", {
      data: { error: "Job not found" },
      message: "Job not found",
    });
  }
  return { ...job };
};
interface DeleteSingleJobResult {
  deleted: true;
}
const deleteSingleJob = (id: string, scenario: MutableScenario): DeleteSingleJobResult => {
  assertMutationAllowed(scenario, "delete");
  getJobById(id, scenario);
  scenario.jobs = scenario.jobs.filter((job) => job.id !== id);
  return { deleted: true };
};
const applyJobMutation = (job: JobDto, mutation: JobMutation, now: string): JobDto => {
  if (mutation.action === "priority") {
    return { ...job, priority: mutation.priority, updatedAt: now };
  }
  const updated: JobDto = {
    ...job,
    status: mutation.action === "cancel" ? "cancelled" : "pending",
    claimedBy: null,
    lockedAt: null,
    lastHeartbeat: null,
    updatedAt: now,
  };
  if (mutation.action === "retry") {
    updated.failCount = 0;
    updated.failureReason = null;
    updated.nextRunAt = now;
  } else if (mutation.action === "reschedule") {
    updated.nextRunAt = new Date(mutation.nextRunAt).toISOString();
  }
  return updated;
};
const mutateSingleJob = (id: string, scenario: MutableScenario, mutation: JobMutation): JobDto => {
  const { action } = mutation;
  assertMutationAllowed(scenario, action === "priority" ? "setJobPriority" : action);
  const job = getJobById(id, scenario);
  if (action === "cancel" && job.status === "cancelled") {
    return job;
  }
  if (
    (action === "retry" && job.status !== "failed" && job.status !== "cancelled") ||
    (action !== "retry" && job.status !== "pending")
  ) {
    throw new ORPCError("CONFLICT", {
      message: "Job state changed before the mutation completed.",
    });
  }
  const updated = applyJobMutation(job, mutation, new Date().toISOString());
  scenario.jobs = scenario.jobs.map((candidate) => (candidate.id === id ? updated : candidate));
  return updated;
};
const decodeCursor = (
  cursor: string | undefined,
  sortBy: MockCursor["sortBy"],
  sortDirection: MockCursor["sortDirection"],
): MockCursor | undefined => {
  if (cursor === undefined || cursor === null || cursor === "") {
    return undefined;
  }
  let parsed: MockCursor;
  try {
    parsed = MockCursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf-8")));
  } catch {
    throw new ORPCError("BAD_REQUEST", { message: "Invalid cursor" });
  }
  if (parsed.sortBy !== sortBy || parsed.sortDirection !== sortDirection) {
    throw new ORPCError("BAD_REQUEST", { message: "Cursor does not match requested sort" });
  }
  return parsed;
};
const comparePositions = (
  left: Pick<MockCursor, "id" | "value">,
  right: Pick<MockCursor, "id" | "value">,
): number => {
  if (left.value < right.value) {
    return -1;
  }
  if (left.value > right.value) {
    return 1;
  }
  return left.id.localeCompare(right.id);
};
const matchesJobName = (job: JobDto, name: string | undefined): boolean =>
  name === undefined || name === null || name === "" || job.name === name;
const matchesJobStatus = (job: JobDto, status: JobListQueryDto["status"]): boolean =>
  status === undefined ||
  (Array.isArray(status) ? status.includes(job.status) : status === job.status);
const matchesDateRange = (value: string, from?: string, to?: string): boolean => {
  const timestamp = Date.parse(value);
  if (!(from === undefined || from === null || from === "") && timestamp < Date.parse(from)) {
    return false;
  }
  if (!(to === undefined || to === null || to === "") && timestamp > Date.parse(to)) {
    return false;
  }
  return true;
};
const applyJobFilters = (jobs: readonly JobDto[], input: JobListQueryDto): readonly JobDto[] =>
  jobs.filter(
    (job) =>
      matchesJobName(job, input.name) &&
      matchesJobStatus(job, input.status) &&
      matchesDateRange(job.createdAt, input.createdAtFrom, input.createdAtTo) &&
      matchesDateRange(job.updatedAt, input.updatedAtFrom, input.updatedAtTo) &&
      matchesDateRange(job.nextRunAt, input.nextRunAtFrom, input.nextRunAtTo),
  );
const normalizeLimit = (limit?: string): number => {
  const parsed = Number(limit ?? "50");
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ORPCError("BAD_REQUEST", { message: "Invalid limit" });
  }
  return Math.min(parsed, 100);
};
const encodeCursor = (cursor: MockCursor): string =>
  Buffer.from(JSON.stringify(cursor), "utf-8").toString("base64url");
const listJobs = (input: JobListQueryDto, scenario: DashboardDevScenario): JobCursorPageDto => {
  const sortBy = input.sortBy ?? "createdAt";
  const sortDirection = input.sortDirection ?? "desc";
  const anchor = decodeCursor(input.cursor, sortBy, sortDirection);
  const sortField = (() => {
    if (sortBy === "identifier") {
      return "id";
    }
    if (sortBy === "updatedAt" || sortBy === "nextRunAt") {
      return sortBy;
    }
    return "createdAt";
  })();
  const compare = (
    left: Pick<MockCursor, "id" | "value">,
    right: Pick<MockCursor, "id" | "value">,
  ) => comparePositions(left, right) * (sortDirection === "asc" ? 1 : -1);
  const position = (job: JobDto) => ({ id: job.id, value: job[sortField] });
  const jobs = applyJobFilters(scenario.jobs, input)
    .filter((job) => !anchor || compare(position(job), anchor) > 0)
    .toSorted((left, right) => compare(position(left), position(right)));
  const pageSize = normalizeLimit(input.limit);
  const pageJobs = jobs.slice(0, pageSize);
  const lastJob = pageJobs.at(-1);
  return {
    jobs: input.view === "summary" ? pageJobs.map((job) => ({ ...job, payload: null })) : pageJobs,
    cursor: lastJob ? encodeCursor({ ...position(lastJob), sortBy, sortDirection }) : null,
    hasNextPage: jobs.length > pageSize,
    hasPreviousPage: anchor !== undefined,
  };
};
const matchesExclusiveUpperDateBound = (value: string, upperBound?: string): boolean => {
  if (upperBound === undefined || upperBound === null || upperBound === "") {
    return true;
  }
  return Date.parse(value) < Date.parse(upperBound);
};
const matchesExclusiveLowerDateBound = (value: string, lowerBound?: string): boolean => {
  if (lowerBound === undefined || lowerBound === null || lowerBound === "") {
    return true;
  }
  return Date.parse(value) > Date.parse(lowerBound);
};
const matchesJobSelector = (job: JobDto, input: JobSelectorDto): boolean =>
  matchesJobName(job, input.name) &&
  matchesJobStatus(job, input.status) &&
  matchesExclusiveUpperDateBound(job.createdAt, input.olderThan) &&
  matchesExclusiveLowerDateBound(job.createdAt, input.newerThan);
const mutateBulkJobs = (
  input: JobSelectorDto,
  scenario: MutableScenario,
  action: "cancel" | "retry" | "delete",
): BulkActionResultDto => {
  assertMutationAllowed(scenario, `${action}Bulk`);
  const jobs = scenario.jobs.filter((job) => matchesJobSelector(job, input));
  const eligible = jobs.filter(
    (job) =>
      action === "delete" ||
      (action === "cancel"
        ? job.status === "pending"
        : job.status === "failed" || job.status === "cancelled"),
  );
  const ids = new Set(eligible.map((job) => job.id));
  const now = new Date().toISOString();
  scenario.jobs =
    action === "delete"
      ? scenario.jobs.filter((job) => !ids.has(job.id))
      : scenario.jobs.map((job) =>
          ids.has(job.id) ? applyJobMutation(job, { action }, now) : job,
        );
  return {
    count: eligible.length,
    errors: [],
  };
};
const createMockManagementOpenApiHandler = (): OpenAPIHandler<MockManagementContext> => {
  const scenarios = new Map<DashboardDevScenarioId, MutableScenario>();
  const getReadableScenario = (context: MockManagementContext): MutableScenario => {
    let scenario = scenarios.get(context.scenarioId);
    if (!scenario) {
      const source = getScenarioOrThrow(context);
      scenario = {
        ...source,
        jobs: source.jobs.map((job) => ({ ...job })),
        globallyPaused: false,
        pausedWorkers: new Set(),
      };
      scenarios.set(context.scenarioId, scenario);
    }
    assertScenarioResponseAllowed(scenario);
    return scenario;
  };
  const getProcessingState = (
    context: MockManagementContext,
    name?: string,
  ): ProcessingStateDto => {
    const scenario = getReadableScenario(context);
    const state: ProcessingStateDto = {
      instanceId: `mock-${context.scenarioId}`,
      paused: scenario.globallyPaused || (name !== undefined && scenario.pausedWorkers.has(name)),
      globallyPaused: scenario.globallyPaused,
    };
    if (name !== undefined) {
      state.name = name;
    }
    return state;
  };
  const controlProcessing = (
    context: MockManagementContext,
    input: ProcessingActionDto,
    action: "pause" | "resume",
  ): ProcessingStateDto => {
    const scenario = getReadableScenario(context);
    assertMutationAllowed(scenario, action);
    if (input.instanceId !== getProcessingState(context).instanceId) {
      throw new ORPCError("CONFLICT", {
        message: "Scheduler instance changed; refresh before retrying",
      });
    }
    if (input.name === undefined) {
      scenario.globallyPaused = action === "pause";
    } else if (action === "pause") {
      scenario.pausedWorkers.add(input.name);
    } else {
      scenario.pausedWorkers.delete(input.name);
    }
    return getProcessingState(context, input.name);
  };
  const mockManagementRouter = managementImplementer.router({
    processingState: managementImplementer.processingState.handler(({ input, context }) =>
      getProcessingState(context, input?.name),
    ),
    pauseProcessing: managementImplementer.pauseProcessing.handler(({ input, context }) =>
      controlProcessing(context, input, "pause"),
    ),
    resumeProcessing: managementImplementer.resumeProcessing.handler(({ input, context }) =>
      controlProcessing(context, input, "resume"),
    ),
    selectedJobActions: managementImplementer.selectedJobActions.handler(({ input, context }) => {
      const scenario = getReadableScenario(context);
      const capability = (() => {
        if (input.action === "priority") {
          return "setJobPriority";
        }
        if (input.action === "reschedule") {
          return "reschedule";
        }
        return `${input.action}Bulk` as const;
      })();
      assertMutationAllowed(scenario, capability);
      const result: BulkActionResultDto = { count: 0, errors: [] };
      for (const id of new Set(input.ids)) {
        try {
          if (input.action === "delete") {
            deleteSingleJob(id, scenario);
          } else {
            mutateSingleJob(
              id,
              scenario,
              input.action === "reschedule" || input.action === "priority"
                ? input
                : { action: input.action },
            );
          }
          result.count += 1;
        } catch (error) {
          result.errors.push({
            jobId: id,
            error: error instanceof Error ? error.message : "Job action failed",
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
    queueViews: managementImplementer.queueViews.handler(({ input, context }) => ({
      queueViews: getReadableScenario(context)
        .queueViews.filter((view) => input?.name === undefined || view.name === input.name)
        .map((view) => ({
          ...view,
          worker: view.worker
            ? { ...view.worker, paused: getProcessingState(context, view.name).paused }
            : null,
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
      const jobs =
        input.name === undefined || input.name === null || input.name === ""
          ? scenario.jobs
          : scenario.jobs.filter((job) => job.name === input.name);
      return createQueueStats(jobs);
    }),
    job: managementImplementer.job.handler(({ input, context }) =>
      getJobById(input.params.id, getReadableScenario(context)),
    ),
    cancelJob: managementImplementer.cancelJob.handler(({ input, context }) =>
      mutateSingleJob(input.params.id, getReadableScenario(context), { action: "cancel" }),
    ),
    retryJob: managementImplementer.retryJob.handler(({ input, context }) =>
      mutateSingleJob(input.params.id, getReadableScenario(context), { action: "retry" }),
    ),
    rescheduleJob: managementImplementer.rescheduleJob.handler(({ input, context }) =>
      mutateSingleJob(input.params.id, getReadableScenario(context), {
        action: "reschedule",
        nextRunAt: input.body.nextRunAt,
      }),
    ),
    setJobPriority: managementImplementer.setJobPriority.handler(({ input, context }) =>
      mutateSingleJob(input.params.id, getReadableScenario(context), {
        action: "priority",
        priority: input.body.priority,
      }),
    ),
    deleteJob: managementImplementer.deleteJob.handler(({ input, context }) =>
      deleteSingleJob(input.params.id, getReadableScenario(context)),
    ),
    cancelJobs: managementImplementer.cancelJobs.handler(({ input, context }) =>
      mutateBulkJobs(input, getReadableScenario(context), "cancel"),
    ),
    retryJobs: managementImplementer.retryJobs.handler(({ input, context }) =>
      mutateBulkJobs(input, getReadableScenario(context), "retry"),
    ),
    deleteJobs: managementImplementer.deleteJobs.handler(({ input, context }) =>
      mutateBulkJobs(input, getReadableScenario(context), "delete"),
    ),
  });
  return new OpenAPIHandler(mockManagementRouter, {
    customErrorResponseBodyEncoder: (error: ORPCError<string, unknown>) =>
      isObject(error.data) && error.data !== null ? error.data : { error: error.message },
  });
};
const createMockManagementFetch = (options?: {
  readonly scenarioId?: DashboardDevScenarioId;
}): typeof fetch => {
  const handler = createMockManagementOpenApiHandler();
  const scenarioId = options?.scenarioId ?? DEFAULT_SCENARIO_ID;
  return async (input, init) => {
    const request = new Request(input, init);
    const result = await handler.handle(request, {
      context: { scenarioId },
    });
    if (!result.matched) {
      return Response.json(
        { error: "Route not found" },
        {
          status: 404,
          headers: { "content-type": "application/json" },
        },
      );
    }
    return result.response;
  };
};
export { createMockManagementFetch, createMockManagementOpenApiHandler };
