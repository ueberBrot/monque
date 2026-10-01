import {
  type BulkOperationResult,
  InvalidCursorError,
  InvalidJobIdentifierError,
  type JobSelector,
  JobStateError,
  type PersistedJob,
} from "@monque/core";
import { implement, ORPCError, type Router } from "@orpc/server";

import {
  toBulkActionResultDto,
  toDeleteJobDto,
  toJobCursorPageDto,
  toJobDto,
  toJobSummaryPageDto,
  toQueueStatsDto,
  toQueueViewSummaryListDto,
  toSchedulerHealthDto,
} from "../mappers/index.js";
import type {
  BulkActionResultDto,
  JobSelectorDto,
  ProcessingActionDto,
  ProcessingStateDto,
  SelectedJobActionsDto,
} from "../schemas/index.js";
import { createManagementActionPolicy } from "../surface/action-policy.js";
import type {
  ManagementAction,
  ManagementOpenApiContext,
  ManagementOptions,
} from "../surface/index.js";
import { parseObjectId, toJobCursorOptions, toJobSelector } from "../surface/request-mapping.js";
import { managementContract, type ManagementContract } from "./contract.js";

type BulkManagementAction = "cancelBulk" | "retryBulk" | "deleteBulk";
type BulkJobMutator = (selector: JobSelector) => Promise<BulkOperationResult>;
type SingleJobMutationInput =
  | { action: "cancel" | "retry" }
  | { action: "reschedule"; nextRunAt: string };
type SingleJobMutator = (id: string) => Promise<PersistedJob | null>;

/** oRPC router type returned by `createManagementRouter()`. */
export type ManagementRouter<TContext = unknown> = Router<
  ManagementContract,
  ManagementOpenApiContext<TContext>
>;

function requiresOpenApiManagementContext<TContext>(options: ManagementOptions<TContext>): boolean {
  return (
    options.authorize !== undefined ||
    options.serializePayload !== undefined ||
    (options.serializePayloadByJobName !== undefined &&
      Object.keys(options.serializePayloadByJobName).length > 0)
  );
}

/**
 * Create an oRPC router that implements the management contract.
 *
 * Use this when integrating with oRPC directly. For a framework-neutral fetch handler,
 * prefer `createManagementSurface()`.
 */
export function createManagementRouter<TContext = unknown>(
  options: ManagementOptions<TContext>,
): ManagementRouter<TContext> {
  const managementImplementer =
    implement(managementContract).$context<ManagementOpenApiContext<TContext>>();
  const policy = createManagementActionPolicy(options);
  const requireContext = requiresOpenApiManagementContext(options);

  return managementImplementer.router({
    processingState: managementImplementer.processingState.handler(
      async ({ input, context: requestContext }) => {
        const context = getOpenApiManagementContext(requestContext);
        await policy.requireAction("read", context);
        return readProcessingState(input?.name);
      },
    ),
    pauseProcessing: managementImplementer.pauseProcessing.handler(
      ({ input, context: requestContext }) => {
        const context = getOpenApiManagementContext(requestContext);
        return executeProcessingAction("pause", input, context);
      },
    ),
    resumeProcessing: managementImplementer.resumeProcessing.handler(
      ({ input, context: requestContext }) => {
        const context = getOpenApiManagementContext(requestContext);
        return executeProcessingAction("resume", input, context);
      },
    ),
    selectedJobActions: managementImplementer.selectedJobActions.handler(
      ({ input, context: requestContext }) => {
        const context = getOpenApiManagementContext(requestContext);
        return handleSelectedJobActions(input, context);
      },
    ),
    health: managementImplementer.health.handler(() =>
      toSchedulerHealthDto(options.monque.isHealthy()),
    ),
    capabilities: managementImplementer.capabilities.handler(
      ({ input, context: requestContext }) => {
        const context = getOpenApiManagementContext(requestContext);
        const state = options.monque.getProcessingState
          ? readProcessingState(input?.name)
          : undefined;
        return policy.getCapabilities(
          context,
          state ? { name: state.name, instanceId: state.instanceId } : {},
        );
      },
    ),
    queueViews: managementImplementer.queueViews.handler(
      async ({ input: filter, context: requestContext }) => {
        const context = getOpenApiManagementContext(requestContext);
        await policy.requireAction("read", context);
        const scope = filter?.name === undefined ? undefined : { name: filter.name };
        const summaries = await options.monque.getQueueViewSummaries(scope);
        // Older compatible scheduler facades may ignore the additive filter argument.
        return toQueueViewSummaryListDto(
          scope ? summaries.filter((view) => view.name === scope.name) : summaries,
        );
      },
    ),
    jobs: managementImplementer.jobs.handler(async ({ input, context: requestContext }) => {
      const context = getOpenApiManagementContext(requestContext);
      await policy.requireAction("read", context);
      const cursorOptions = toJobCursorOptions(input);
      if ("error" in cursorOptions) {
        throw new ORPCError("BAD_REQUEST", { message: cursorOptions.error });
      }
      try {
        if (input.view === "summary") {
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
          throw new ORPCError("BAD_REQUEST", { message: error.message });
        }
        throw error;
      }
    }),
    jobStats: managementImplementer.jobStats.handler(async ({ input, context: requestContext }) => {
      const context = getOpenApiManagementContext(requestContext);
      await policy.requireAction("read", context);
      return toQueueStatsDto(
        await options.monque.getQueueStats(
          input.name === undefined ? undefined : { name: input.name },
        ),
      );
    }),
    job: managementImplementer.job.handler(async ({ input, context: requestContext }) => {
      const context = getOpenApiManagementContext(requestContext);
      await policy.requireAction("read", context);
      const { job } = await resolvePersistedJob(input.params.id);
      return toJobDto(options, job, context);
    }),
    cancelJob: managementImplementer.cancelJob.handler(
      async ({ input, context: requestContext }) => {
        const context = getOpenApiManagementContext(requestContext);
        return toJobDto(
          options,
          await executeJobMutation({ action: "cancel" }, input.params.id, context),
          context,
        );
      },
    ),
    retryJob: managementImplementer.retryJob.handler(async ({ input, context: requestContext }) => {
      const context = getOpenApiManagementContext(requestContext);
      return toJobDto(
        options,
        await executeJobMutation({ action: "retry" }, input.params.id, context),
        context,
      );
    }),
    rescheduleJob: managementImplementer.rescheduleJob.handler(
      async ({ input, context: requestContext }) => {
        const context = getOpenApiManagementContext(requestContext);
        return toJobDto(
          options,
          await executeJobMutation(
            { action: "reschedule", nextRunAt: input.body.nextRunAt },
            input.params.id,
            context,
          ),
          context,
        );
      },
    ),
    deleteJob: managementImplementer.deleteJob.handler(
      async ({ input, context: requestContext }) => {
        const context = getOpenApiManagementContext(requestContext);
        await executeJobDeletion(input.params.id, context);
        return toDeleteJobDto();
      },
    ),
    cancelJobs: managementImplementer.cancelJobs.handler(({ input, context: requestContext }) => {
      const context = getOpenApiManagementContext(requestContext);
      return handleBulkJobMutation(
        "cancelBulk",
        input,
        context,
        options.monque.cancelJobs?.bind(options.monque),
      );
    }),
    retryJobs: managementImplementer.retryJobs.handler(({ input, context: requestContext }) => {
      const context = getOpenApiManagementContext(requestContext);
      return handleBulkJobMutation(
        "retryBulk",
        input,
        context,
        options.monque.retryJobs?.bind(options.monque),
      );
    }),
    deleteJobs: managementImplementer.deleteJobs.handler(({ input, context: requestContext }) => {
      const context = getOpenApiManagementContext(requestContext);
      return handleBulkJobMutation(
        "deleteBulk",
        input,
        context,
        options.monque.deleteJobs?.bind(options.monque),
      );
    }),
  });

  function readProcessingState(name?: string): ProcessingStateDto {
    if (!options.monque.getProcessingState) {
      throw new ORPCError("FORBIDDEN", { message: "Processing state is unsupported" });
    }
    try {
      const state = options.monque.getProcessingState(name);
      return {
        instanceId: state.instanceId,
        ...(state.name === undefined ? {} : { name: state.name }),
        paused: state.paused,
        globallyPaused: state.globallyPaused,
      };
    } catch (error) {
      if (error instanceof InvalidJobIdentifierError) {
        throw new ORPCError("BAD_REQUEST", { message: error.message });
      }
      throw error;
    }
  }

  async function executeProcessingAction(
    action: "pause" | "resume",
    input: ProcessingActionDto,
    context: TContext,
  ): Promise<ProcessingStateDto> {
    const mutate = options.monque[action];
    policy.requireSupported(action);
    const supportedMutate = policy.requireMutation(action, mutate);
    await policy.requireAction(action, context, {
      name: input.name,
      instanceId: input.instanceId,
    });
    const state = readProcessingState(input.name);
    if (state.instanceId !== input.instanceId) {
      throw new ORPCError("CONFLICT", {
        message: "Scheduler instance changed; refresh before retrying",
      });
    }
    supportedMutate.call(options.monque, input.name);
    return readProcessingState(input.name);
  }

  async function executeJobMutation(
    input: SingleJobMutationInput,
    idInput: string,
    context: TContext,
  ): Promise<PersistedJob> {
    const mutate =
      input.action === "reschedule"
        ? toRescheduleJobMutator(new Date(input.nextRunAt))
        : input.action === "retry"
          ? options.monque.retryJob?.bind(options.monque)
          : options.monque.cancelJob?.bind(options.monque);
    const supportedMutate = policy.requireMutation(input.action, mutate);
    const id = await resolveSingleJobTarget(input.action, idInput, context);
    const job = await mapJobStateConflict(() => supportedMutate(id));

    if (!job) {
      throw new ORPCError("NOT_FOUND", { message: "Job not found" });
    }

    return job;
  }

  async function executeJobDeletion(idInput: string, context: TContext): Promise<void> {
    const supportedMutate = policy.requireMutation(
      "delete",
      options.monque.deleteJob?.bind(options.monque),
    );
    const id = await resolveSingleJobTarget("delete", idInput, context);
    const deleted = await supportedMutate(id);

    if (!deleted) {
      throw new ORPCError("NOT_FOUND", { message: "Job not found" });
    }
  }

  function toRescheduleJobMutator(runAt: Date): SingleJobMutator | undefined {
    const rescheduleJob = options.monque.rescheduleJob?.bind(options.monque);

    if (rescheduleJob === undefined) {
      return undefined;
    }

    return (id) => rescheduleJob(id, runAt);
  }

  async function resolveSingleJobTarget(
    action: Exclude<ManagementAction, "read">,
    idInput: string,
    context: TContext,
  ): Promise<string> {
    const { id, job } = await resolvePersistedJob(idInput);

    await policy.requireAction(action, context, { job });

    return id.toHexString();
  }

  async function resolvePersistedJob(
    idInput: string,
  ): Promise<{ id: PersistedJob["_id"]; job: PersistedJob }> {
    const id = parseObjectId(idInput);

    if ("error" in id) {
      throw new ORPCError("BAD_REQUEST", { message: id.error });
    }

    const target = await options.monque.getJob(idInput);

    if (!target) {
      throw new ORPCError("NOT_FOUND", { message: "Job not found" });
    }

    return { id: id.value, job: target };
  }

  async function handleBulkJobMutation(
    action: BulkManagementAction,
    input: JobSelectorDto,
    context: TContext,
    mutate: BulkJobMutator | undefined,
  ) {
    const supportedMutate = policy.requireMutation(action, mutate);
    const selector = toJobSelector(input);

    await policy.requireAction(action, context, { selector });

    return toBulkActionResultDto(await mapJobStateConflict(() => supportedMutate(selector)));
  }

  async function mapJobStateConflict<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof JobStateError) {
        throw new ORPCError("CONFLICT", { message: error.message });
      }

      throw error;
    }
  }

  async function handleSelectedJobActions(
    input: SelectedJobActionsDto,
    context: TContext,
  ): Promise<BulkActionResultDto> {
    const capability =
      input.action === "reschedule" ? "reschedule" : (`${input.action}Bulk` as const);
    policy.requireSupported(capability);
    const ids = [
      ...new Set(input.ids.map((id) => (/^[a-fA-F0-9]{24}$/.test(id) ? id.toLowerCase() : id))),
    ];
    await policy.requireAction(capability, context, { ids });
    const result: BulkActionResultDto = { count: 0, errors: [] };
    const remainingIds = ids.values();
    await Promise.all(
      Array.from({ length: Math.min(5, ids.length) }, async () => {
        for (const id of remainingIds) {
          try {
            if (input.action === "delete") {
              await executeJobDeletion(id, context);
            } else {
              await executeJobMutation(
                input.action === "reschedule" ? input : { action: input.action },
                id,
                context,
              );
            }
            result.count++;
          } catch (error) {
            result.errors.push({
              jobId: id,
              status: error instanceof ORPCError ? error.status : 500,
              error: error instanceof ORPCError ? error.message : "Job action failed",
            });
          }
        }
      }),
    );
    return result;
  }

  function getOpenApiManagementContext(context: ManagementOpenApiContext<TContext>): TContext {
    if (requireContext && context.managementContext === undefined) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message:
          "Missing managementContext in openApiHandler.handle() context; managementContext is required for authorize/serializePayload hooks.",
      });
    }

    return context.managementContext as TContext;
  }
}
