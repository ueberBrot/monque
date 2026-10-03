import {
  type BulkOperationResult,
  type CursorOptions,
  InvalidCursorError,
  InvalidJobIdentifierError,
  type JobSelector,
  JobStateError,
  type PersistedJob,
} from "@monque/core";
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
  | { action: "reschedule"; nextRunAt: string };
type SingleJobMutator = (id: string) => Promise<PersistedJob | null>;

export function createManagementOperations<TContext>(options: ManagementOptions<TContext>) {
  const policy = createManagementActionPolicy(options);

  const readProcessingState = Effect.fnUntraced(function* (
    name?: string,
  ): Effect.fn.Return<ProcessingStateDto, unknown> {
    if (!options.monque.getProcessingState) {
      return yield* managementError("FORBIDDEN", "Processing state is unsupported");
    }
    return yield* attempt(() => {
      const state = options.monque.getProcessingState!(name);
      return {
        instanceId: state.instanceId,
        ...(state.name === undefined ? {} : { name: state.name }),
        paused: state.paused,
        globallyPaused: state.globallyPaused,
      };
    }).pipe(
      Effect.mapError((error) =>
        error instanceof InvalidJobIdentifierError
          ? new ORPCError("BAD_REQUEST", { message: error.message })
          : error,
      ),
    );
  });

  const processingState = Effect.fnUntraced(function* (
    name: string | undefined,
    context: TContext,
  ) {
    yield* policy.requireAction("read", context);
    return yield* readProcessingState(name);
  });

  const processingAction = Effect.fnUntraced(function* (
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
    yield* attempt(() => supportedMutate.call(options.monque, input.name));
    return yield* readProcessingState(input.name);
  });

  const capabilities = Effect.fnUntraced(function* (name: string | undefined, context: TContext) {
    const state = options.monque.getProcessingState ? yield* readProcessingState(name) : undefined;
    return yield* policy.getCapabilities(
      context,
      state ? { name: state.name, instanceId: state.instanceId } : {},
    );
  });

  const queueViews = Effect.fnUntraced(function* (
    filter: QueueViewQueryDto | undefined,
    context: TContext,
  ) {
    yield* policy.requireAction("read", context);
    const scope = filter?.name === undefined ? undefined : { name: filter.name };
    const summaries = yield* fromPromise(() => options.monque.getQueueViewSummaries(scope));
    return yield* attempt(() =>
      toQueueViewSummaryListDto(
        scope ? summaries.filter((view) => view.name === scope.name) : summaries,
      ),
    );
  });

  async function serializeJob(job: PersistedJob, context: TContext) {
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
  }

  const readJobsPage = Effect.fnUntraced(function* (
    cursorOptions: CursorOptions,
    summary: boolean,
    context: TContext,
  ) {
    if (summary) {
      const page = yield* fromPromise(() =>
        options.monque.getJobSummariesWithCursor
          ? options.monque.getJobSummariesWithCursor(cursorOptions)
          : options.monque.getJobsWithCursor(cursorOptions),
      );
      return yield* attempt(() => toJobSummaryPageDto(page));
    }
    const page = yield* fromPromise(() => options.monque.getJobsWithCursor(cursorOptions));
    const jobs = yield* fromPromise(() =>
      Promise.all(page.jobs.map((job) => serializeJob(job, context))),
    );
    return {
      jobs,
      cursor: page.cursor,
      hasNextPage: page.hasNextPage,
      hasPreviousPage: page.hasPreviousPage,
    };
  });

  const jobs = Effect.fnUntraced(function* (input: JobListQueryDto, context: TContext) {
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

  const jobStats = Effect.fnUntraced(function* (input: JobStatsQueryDto, context: TContext) {
    yield* policy.requireAction("read", context);
    const stats = yield* fromPromise(() =>
      options.monque.getQueueStats(input.name === undefined ? undefined : { name: input.name }),
    );
    return yield* attempt(() => toQueueStatsDto(stats));
  });

  const resolvePersistedJob = Effect.fnUntraced(function* (idInput: string) {
    const id = yield* attempt(() => parseObjectId(idInput));
    if ("error" in id) return yield* managementError("BAD_REQUEST", id.error);
    const job = yield* fromPromise(() => options.monque.getJob(idInput));
    if (!job) return yield* managementError("NOT_FOUND", "Job not found");
    return { id: id.value, job };
  });

  const job = Effect.fnUntraced(function* (idInput: string, context: TContext) {
    yield* policy.requireAction("read", context);
    const { job } = yield* resolvePersistedJob(idInput);
    return yield* fromPromise(() => serializeJob(job, context));
  });

  const resolveSingleJobTarget = Effect.fnUntraced(function* (
    action: Exclude<ManagementAction, "read">,
    idInput: string,
    context: TContext,
  ) {
    const { id, job } = yield* resolvePersistedJob(idInput);
    yield* policy.requireAction(action, context, { job });
    return yield* attempt(() => id.toHexString());
  });

  const executeJobMutation = Effect.fnUntraced(function* (
    input: SingleJobMutationInput,
    idInput: string,
    context: TContext,
  ) {
    const mutate = yield* attempt(() =>
      input.action === "reschedule"
        ? toRescheduleJobMutator(new Date(input.nextRunAt))
        : input.action === "retry"
          ? options.monque.retryJob?.bind(options.monque)
          : options.monque.cancelJob?.bind(options.monque),
    );
    const supportedMutate = yield* policy.requireMutation(input.action, mutate);
    const id = yield* resolveSingleJobTarget(input.action, idInput, context);
    const job = yield* mapJobStateConflict(fromPromise(() => supportedMutate(id)));
    if (!job) return yield* managementError("NOT_FOUND", "Job not found");
    return job;
  });

  const mutateJob = Effect.fnUntraced(function* (
    input: SingleJobMutationInput,
    idInput: string,
    context: TContext,
  ) {
    const job = yield* executeJobMutation(input, idInput, context);
    return yield* fromPromise(() => serializeJob(job, context));
  });

  const executeJobDeletion = Effect.fnUntraced(function* (idInput: string, context: TContext) {
    const supportedMutate = yield* policy.requireMutation(
      "delete",
      options.monque.deleteJob?.bind(options.monque),
    );
    const id = yield* resolveSingleJobTarget("delete", idInput, context);
    const deleted = yield* fromPromise(() => supportedMutate(id));
    if (!deleted) return yield* managementError("NOT_FOUND", "Job not found");
  });

  const deleteJob = Effect.fnUntraced(function* (idInput: string, context: TContext) {
    yield* executeJobDeletion(idInput, context);
    return toDeleteJobDto();
  });

  const bulkJobMutation = Effect.fnUntraced(function* (
    action: BulkManagementAction,
    input: JobSelectorDto,
    context: TContext,
    mutate: BulkJobMutator | undefined,
  ) {
    const supportedMutate = yield* policy.requireMutation(action, mutate);
    const selector = yield* attempt(() => toJobSelector(input));
    yield* policy.requireAction(action, context, { selector });
    const result = yield* mapJobStateConflict(fromPromise(() => supportedMutate(selector)));
    return yield* attempt(() => toBulkActionResultDto(result));
  });

  const selectedJobActions = Effect.fnUntraced(function* (
    input: SelectedJobActionsDto,
    context: TContext,
  ): Effect.fn.Return<BulkActionResultDto, unknown> {
    const capability =
      input.action === "reschedule" ? "reschedule" : (`${input.action}Bulk` as const);
    yield* policy.requireSupported(capability);
    const ids = [
      ...new Set(input.ids.map((id) => (/^[a-fA-F0-9]{24}$/.test(id) ? id.toLowerCase() : id))),
    ];
    yield* policy.requireAction(capability, context, { ids });
    const result: BulkActionResultDto = { count: 0, errors: [] };
    yield* Effect.forEach(
      ids,
      (id) => {
        const operation: Effect.Effect<unknown, unknown> =
          input.action === "delete"
            ? executeJobDeletion(id, context)
            : executeJobMutation(
                input.action === "reschedule" ? input : { action: input.action },
                id,
                context,
              );
        return operation.pipe(
          Effect.catchDefect(Effect.fail),
          Effect.matchEffect({
            onSuccess: () =>
              Effect.sync(() => {
                result.count++;
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
    job,
    mutateJob,
    deleteJob,
    bulkJobMutation,
    selectedJobActions,
    health: () => toSchedulerHealthDto(options.monque.isHealthy()),
  };

  function toRescheduleJobMutator(runAt: Date): SingleJobMutator | undefined {
    const rescheduleJob = options.monque.rescheduleJob?.bind(options.monque);
    return rescheduleJob === undefined ? undefined : (id) => rescheduleJob(id, runAt);
  }
}

function managementError(
  code: "BAD_REQUEST" | "FORBIDDEN" | "CONFLICT" | "NOT_FOUND",
  message: string,
) {
  return Effect.fail(new ORPCError(code, { message }));
}

function mapJobStateConflict<A>(operation: Effect.Effect<A, unknown>) {
  return operation.pipe(
    Effect.mapError((error) =>
      error instanceof JobStateError
        ? new ORPCError("CONFLICT", { message: error.message })
        : error,
    ),
  );
}
