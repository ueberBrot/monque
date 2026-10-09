import { InvalidCursorError, InvalidJobIdentifierError, JobStateError } from "@monque/core";
import type { BulkOperationResult, CursorOptions, JobSelector, PersistedJob } from "@monque/core";
import { ORPCError } from "@orpc/server";
import * as Effect from "effect/Effect";

import { attempt, fromPromise } from "../effects.js";
import {
  toBulkActionResultDto,
  toDeleteJobDto,
  toJobSummaryDto,
  toJobSummaryPageDto,
  toQueueStatsDto,
  toQueueViewSummaryListDto,
  toSchedulerHealthDto,
} from "../mappers/index.js";
import type {
  BulkActionResultDto,
  JobListQueryDto,
  JobSelectorDto,
  JobStatsQueryDto,
  ProcessingActionDto,
  ProcessingStateDto,
  QueueViewQueryDto,
  SelectedJobActionsDto,
} from "../schemas/index.js";
import { createManagementActionPolicy } from "../surface/action-policy.js";
import { parseObjectId, toJobCursorOptions, toJobSelector } from "../surface/request-mapping.js";
import type { ManagementAction, ManagementOptions } from "../surface/types.js";

type BulkManagementAction = "cancelBulk" | "retryBulk" | "deleteBulk";
type BulkJobMutator = (selector: JobSelector) => Promise<BulkOperationResult>;
type SingleJobMutationInput =
  | { action: "cancel" | "retry" }
  | { action: "reschedule"; nextRunAt: string }
  | { action: "setJobPriority"; priority: number };
type SingleJobMutator = (id: string) => Promise<PersistedJob | null>;

const managementError = function managementError(
  code: "BAD_REQUEST" | "FORBIDDEN" | "CONFLICT" | "NOT_FOUND",
  message: string,
) {
  return Effect.fail(new ORPCError(code, { message }));
};

const mapJobStateConflict = function mapJobStateConflict<A>(operation: Effect.Effect<A, unknown>) {
  return operation.pipe(
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Effect.mapError transforms an Effect error channel, not a Promise callback.
    Effect.mapError((error) =>
      error instanceof JobStateError
        ? new ORPCError("CONFLICT", { message: error.message })
        : error,
    ),
  );
};

export const createManagementOperations = function createManagementOperations<TContext>(
  options: ManagementOptions<TContext>,
) {
  const policy = createManagementActionPolicy(options);

  const readProcessingState = Effect.fnUntraced(function* readProcessingState(
    name?: string,
  ): Effect.fn.Return<ProcessingStateDto, unknown> {
    if (!options.monque.getProcessingState) {
      return yield* managementError("FORBIDDEN", "Processing state is unsupported");
    }
    return yield* attempt(() => {
      // oxlint-disable-next-line typescript/no-non-null-assertion -- The preceding branch rejects unsupported facades; keep the method receiver.
      const state = options.monque.getProcessingState!(name);
      const result: ProcessingStateDto = {
        instanceId: state.instanceId,
        paused: state.paused,
        globallyPaused: state.globallyPaused,
      };
      if (state.name !== undefined) {
        result.name = state.name;
      }
      return result;
    }).pipe(
      Effect.mapError((error) =>
        error instanceof InvalidJobIdentifierError
          ? new ORPCError("BAD_REQUEST", { message: error.message })
          : error,
      ),
    );
  });

  const processingState = Effect.fnUntraced(function* processingState(
    name: string | undefined,
    context: TContext,
  ) {
    yield* policy.requireAction("read", context);
    return yield* readProcessingState(name);
  });

  const processingAction = Effect.fnUntraced(function* processingAction(
    action: "pause" | "resume",
    input: ProcessingActionDto,
    context: TContext,
  ) {
    const mutate = options.monque[action];
    yield* policy.requireSupported(action);
    const supportedMutate = yield* policy.requireMutation(action, mutate);
    yield* policy.requireAction(action, context, {
      name: input.name,
      instanceId: input.instanceId,
    });
    const state = yield* readProcessingState(input.name);
    if (state.instanceId !== input.instanceId) {
      return yield* managementError(
        "CONFLICT",
        "Scheduler instance changed; refresh before retrying",
      );
    }
    yield* attempt(() => {
      supportedMutate.call(options.monque, input.name);
    });
    return yield* readProcessingState(input.name);
  });

  const capabilities = Effect.fnUntraced(function* capabilities(
    name: string | undefined,
    context: TContext,
  ) {
    const state = options.monque.getProcessingState ? yield* readProcessingState(name) : undefined;
    return yield* policy.getCapabilities(
      context,
      state ? { name: state.name, instanceId: state.instanceId } : {},
    );
  });

  const queueViews = Effect.fnUntraced(function* queueViews(
    filter: QueueViewQueryDto | undefined,
    context: TContext,
  ) {
    yield* policy.requireAction("read", context);
    const scope = filter?.name === undefined ? undefined : { name: filter.name };
    const summaries = yield* fromPromise(
      async () => await options.monque.getQueueViewSummaries(scope),
    );
    return yield* attempt(() =>
      toQueueViewSummaryListDto(
        scope ? summaries.filter((view) => view.name === scope.name) : summaries,
      ),
    );
  });

  const serializeJob = async function serializeJob(job: PersistedJob, context: TContext) {
    const dto = toJobSummaryDto(job);
    const jobName = job.name;
    const serializers = options.serializePayloadByJobName;
    const serializePayload =
      (serializers && Object.hasOwn(serializers, jobName) ? serializers[jobName] : undefined) ??
      options.serializePayload;
    dto.payload = await (serializePayload
      ? serializePayload({ job, payload: job.data, context })
      : job.data);
    return dto;
  };

  const readJobsPage = Effect.fnUntraced(function* readJobsPage(
    cursorOptions: CursorOptions,
    summary: boolean,
    context: TContext,
  ) {
    if (summary) {
      const page = yield* fromPromise(async () =>
        options.monque.getJobSummariesWithCursor
          ? await options.monque.getJobSummariesWithCursor(cursorOptions)
          : await options.monque.getJobsWithCursor(cursorOptions),
      );
      return yield* attempt(() => toJobSummaryPageDto(page));
    }
    const page = yield* fromPromise(
      async () => await options.monque.getJobsWithCursor(cursorOptions),
    );
    const jobs = yield* fromPromise(
      async () => await Promise.all(page.jobs.map(async (job) => await serializeJob(job, context))),
    );
    return {
      jobs,
      cursor: page.cursor,
      hasNextPage: page.hasNextPage,
      hasPreviousPage: page.hasPreviousPage,
    };
  });

  const jobs = Effect.fnUntraced(function* jobs(input: JobListQueryDto, context: TContext) {
    yield* policy.requireAction("read", context);
    const cursorOptions = yield* attempt(() => toJobCursorOptions(input));
    if ("error" in cursorOptions) {
      return yield* managementError("BAD_REQUEST", cursorOptions.error);
    }
    return yield* readJobsPage(cursorOptions, input.view === "summary", context).pipe(
      Effect.catchDefect(Effect.fail),
      Effect.mapError((error) =>
        error instanceof InvalidCursorError
          ? new ORPCError("BAD_REQUEST", { message: error.message })
          : error,
      ),
    );
  });

  const jobStats = Effect.fnUntraced(function* jobStats(
    input: JobStatsQueryDto,
    context: TContext,
  ) {
    yield* policy.requireAction("read", context);
    const stats = yield* fromPromise(
      async () =>
        await options.monque.getQueueStats(
          input.name === undefined ? undefined : { name: input.name },
        ),
    );
    return yield* attempt(() => toQueueStatsDto(stats));
  });

  const resolvePersistedJob = Effect.fnUntraced(function* resolvePersistedJob(idInput: string) {
    const id = yield* attempt(() => parseObjectId(idInput));
    if ("error" in id) {
      return yield* managementError("BAD_REQUEST", id.error);
    }
    const job = yield* fromPromise(async () => await options.monque.getJob(idInput));
    if (!job) {
      return yield* managementError("NOT_FOUND", "Job not found");
    }
    return { id: id.value, job };
  });

  const readJob = Effect.fnUntraced(function* readJob(idInput: string, context: TContext) {
    yield* policy.requireAction("read", context);
    const { job } = yield* resolvePersistedJob(idInput);
    return yield* fromPromise(async () => await serializeJob(job, context));
  });

  const resolveSingleJobTarget = Effect.fnUntraced(function* resolveSingleJobTarget(
    action: Exclude<ManagementAction, "read">,
    idInput: string,
    context: TContext,
  ) {
    const { id, job } = yield* resolvePersistedJob(idInput);
    yield* policy.requireAction(action, context, { job });
    return yield* attempt(() => id.toHexString());
  });

  const resolveJobMutator = function resolveJobMutator(
    input: SingleJobMutationInput,
  ): SingleJobMutator | undefined {
    switch (input.action) {
      case "cancel": {
        return options.monque.cancelJob?.bind(options.monque);
      }
      case "retry": {
        return options.monque.retryJob?.bind(options.monque);
      }
      case "reschedule": {
        const runAt = new Date(input.nextRunAt);
        const rescheduleJob = options.monque.rescheduleJob?.bind(options.monque);
        return rescheduleJob === undefined
          ? undefined
          : async (id) => await rescheduleJob(id, runAt);
      }
      case "setJobPriority": {
        const { priority } = input;
        const setJobPriority = options.monque.setJobPriority?.bind(options.monque);
        return setJobPriority === undefined
          ? undefined
          : async (id) => await setJobPriority(id, priority);
      }
      default: {
        return undefined;
      }
    }
  };

  const executeJobMutation = Effect.fnUntraced(function* executeJobMutation(
    input: SingleJobMutationInput,
    idInput: string,
    context: TContext,
  ) {
    const mutate = yield* attempt(() => resolveJobMutator(input));
    const supportedMutate = yield* policy.requireMutation(input.action, mutate);
    const id = yield* resolveSingleJobTarget(input.action, idInput, context);
    const job = yield* mapJobStateConflict(fromPromise(async () => await supportedMutate(id)));
    if (!job) {
      return yield* managementError("NOT_FOUND", "Job not found");
    }
    return job;
  });

  const mutateJob = Effect.fnUntraced(function* mutateJob(
    input: SingleJobMutationInput,
    idInput: string,
    context: TContext,
  ) {
    const job = yield* executeJobMutation(input, idInput, context);
    return yield* fromPromise(async () => await serializeJob(job, context));
  });

  const executeJobDeletion = Effect.fnUntraced(function* executeJobDeletion(
    idInput: string,
    context: TContext,
  ) {
    const supportedMutate = yield* policy.requireMutation(
      "delete",
      options.monque.deleteJob?.bind(options.monque),
    );
    const id = yield* resolveSingleJobTarget("delete", idInput, context);
    const deleted = yield* fromPromise(async () => await supportedMutate(id));
    if (!deleted) {
      return yield* managementError("NOT_FOUND", "Job not found");
    }
    return yield* Effect.void;
  });

  const deleteJob = Effect.fnUntraced(function* deleteJob(idInput: string, context: TContext) {
    yield* executeJobDeletion(idInput, context);
    return toDeleteJobDto();
  });

  const bulkJobMutation = Effect.fnUntraced(function* bulkJobMutation(
    action: BulkManagementAction,
    input: JobSelectorDto,
    context: TContext,
    mutate: BulkJobMutator | undefined,
  ) {
    const supportedMutate = yield* policy.requireMutation(action, mutate);
    const selector = yield* attempt(() => toJobSelector(input));
    yield* policy.requireAction(action, context, { selector });
    const result = yield* mapJobStateConflict(
      fromPromise(async () => await supportedMutate(selector)),
    );
    return yield* attempt(() => toBulkActionResultDto(result));
  });

  const selectedJobActions = Effect.fnUntraced(function* selectedJobActions(
    input: SelectedJobActionsDto,
    context: TContext,
  ): Effect.fn.Return<BulkActionResultDto, unknown> {
    let capability: ManagementAction;
    if (input.action === "priority") {
      capability = "setJobPriority";
    } else if (input.action === "reschedule") {
      capability = "reschedule";
    } else {
      capability = `${input.action}Bulk`;
    }
    yield* policy.requireSupported(capability);
    const ids = [
      ...new Set(input.ids.map((id) => (/^[a-fA-F0-9]{24}$/u.test(id) ? id.toLowerCase() : id))),
    ];
    yield* policy.requireAction(capability, context, { ids });
    const result: BulkActionResultDto = { count: 0, errors: [] };
    // oxlint-disable-next-line unicorn/no-array-for-each -- Effect.forEach traverses Effects, not an Array callback.
    yield* Effect.forEach(
      ids,
      (id) => {
        let operation: Effect.Effect<unknown, unknown>;
        if (input.action === "delete") {
          operation = executeJobDeletion(id, context);
        } else if (input.action === "priority") {
          operation = executeJobMutation(
            { action: "setJobPriority", priority: input.priority },
            id,
            context,
          );
        } else if (input.action === "reschedule") {
          operation = executeJobMutation(input, id, context);
        } else {
          operation = executeJobMutation({ action: input.action }, id, context);
        }
        return operation.pipe(
          Effect.catchDefect(Effect.fail),
          Effect.matchEffect({
            onSuccess: () =>
              Effect.sync(() => {
                result.count += 1;
              }),
            onFailure: (error) =>
              Effect.sync(() => {
                result.errors.push({
                  jobId: id,
                  status: error instanceof ORPCError ? error.status : 500,
                  error: error instanceof ORPCError ? error.message : "Job action failed",
                });
              }),
          }),
        );
      },
      { concurrency: 5, discard: true },
    );
    return result;
  });

  return {
    processingState,
    processingAction,
    capabilities,
    queueViews,
    jobs,
    jobStats,
    job: readJob,
    mutateJob,
    deleteJob,
    bulkJobMutation,
    selectedJobActions,
    health: () => toSchedulerHealthDto(options.monque.isHealthy()),
  };
};
