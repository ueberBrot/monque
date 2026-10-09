import { implement, ORPCError } from "@orpc/server";
import type { Router } from "@orpc/server";
import * as Effect from "effect/Effect";

import type { ManagementOpenApiContext, ManagementOptions } from "../surface/index.js";
import { managementContract } from "./contract.js";
import type { ManagementContract } from "./contract.js";
import { createManagementOperations } from "./operations.js";

/** oRPC router type returned by `createManagementRouter()`. */
export type ManagementRouter<TContext = unknown> = Router<
  ManagementContract,
  ManagementOpenApiContext<TContext>
>;

const requiresOpenApiManagementContext = function requiresOpenApiManagementContext<TContext>(
  options: ManagementOptions<TContext>,
): boolean {
  return (
    options.authorize !== undefined ||
    options.serializePayload !== undefined ||
    (options.serializePayloadByJobName !== undefined &&
      Object.keys(options.serializePayloadByJobName).length > 0)
  );
};

/**
 * Create an oRPC router that implements the management contract.
 *
 * Use this when integrating with oRPC directly. For a framework-neutral fetch handler,
 * prefer `createManagementSurface()`.
 */
export const createManagementRouter = function createManagementRouter<TContext = unknown>(
  options: ManagementOptions<TContext>,
): ManagementRouter<TContext> {
  const managementImplementer =
    implement(managementContract).$context<ManagementOpenApiContext<TContext>>();
  const operations = createManagementOperations(options);
  const requireContext = requiresOpenApiManagementContext(options);

  const getOpenApiManagementContext = function getOpenApiManagementContext(
    context: ManagementOpenApiContext<TContext>,
  ): TContext {
    if (requireContext && context.managementContext === undefined) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message:
          "Missing managementContext in openApiHandler.handle() context; managementContext is required for authorize/serializePayload hooks.",
      });
    }

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SAFETY: Missing context is permitted only when no hooks consume TContext; preserve the public generic adapter contract.
    return context.managementContext as TContext;
  };

  return managementImplementer.router({
    processingState: managementImplementer.processingState.handler(
      async ({ input, context }) =>
        await Effect.runPromise(
          operations.processingState(input?.name, getOpenApiManagementContext(context)),
        ),
    ),
    pauseProcessing: managementImplementer.pauseProcessing.handler(
      async ({ input, context }) =>
        await Effect.runPromise(
          operations.processingAction("pause", input, getOpenApiManagementContext(context)),
        ),
    ),
    resumeProcessing: managementImplementer.resumeProcessing.handler(
      async ({ input, context }) =>
        await Effect.runPromise(
          operations.processingAction("resume", input, getOpenApiManagementContext(context)),
        ),
    ),
    selectedJobActions: managementImplementer.selectedJobActions.handler(
      async ({ input, context }) =>
        await Effect.runPromise(
          operations.selectedJobActions(input, getOpenApiManagementContext(context)),
        ),
    ),
    health: managementImplementer.health.handler(operations.health),
    capabilities: managementImplementer.capabilities.handler(
      async ({ input, context }) =>
        await Effect.runPromise(
          operations.capabilities(input?.name, getOpenApiManagementContext(context)),
        ),
    ),
    queueViews: managementImplementer.queueViews.handler(
      async ({ input, context }) =>
        await Effect.runPromise(operations.queueViews(input, getOpenApiManagementContext(context))),
    ),
    jobs: managementImplementer.jobs.handler(
      async ({ input, context }) =>
        await Effect.runPromise(operations.jobs(input, getOpenApiManagementContext(context))),
    ),
    jobStats: managementImplementer.jobStats.handler(
      async ({ input, context }) =>
        await Effect.runPromise(operations.jobStats(input, getOpenApiManagementContext(context))),
    ),
    job: managementImplementer.job.handler(
      async ({ input, context }) =>
        await Effect.runPromise(
          operations.job(input.params.id, getOpenApiManagementContext(context)),
        ),
    ),
    cancelJob: managementImplementer.cancelJob.handler(
      async ({ input, context }) =>
        await Effect.runPromise(
          operations.mutateJob(
            { action: "cancel" },
            input.params.id,
            getOpenApiManagementContext(context),
          ),
        ),
    ),
    retryJob: managementImplementer.retryJob.handler(
      async ({ input, context }) =>
        await Effect.runPromise(
          operations.mutateJob(
            { action: "retry" },
            input.params.id,
            getOpenApiManagementContext(context),
          ),
        ),
    ),
    rescheduleJob: managementImplementer.rescheduleJob.handler(
      async ({ input, context }) =>
        await Effect.runPromise(
          operations.mutateJob(
            { action: "reschedule", nextRunAt: input.body.nextRunAt },
            input.params.id,
            getOpenApiManagementContext(context),
          ),
        ),
    ),
    setJobPriority: managementImplementer.setJobPriority.handler(
      async ({ input, context }) =>
        await Effect.runPromise(
          operations.mutateJob(
            { action: "setJobPriority", priority: input.body.priority },
            input.params.id,
            getOpenApiManagementContext(context),
          ),
        ),
    ),
    deleteJob: managementImplementer.deleteJob.handler(
      async ({ input, context }) =>
        await Effect.runPromise(
          operations.deleteJob(input.params.id, getOpenApiManagementContext(context)),
        ),
    ),
    cancelJobs: managementImplementer.cancelJobs.handler(
      async ({ input, context }) =>
        await Effect.runPromise(
          operations.bulkJobMutation(
            "cancelBulk",
            input,
            getOpenApiManagementContext(context),
            options.monque.cancelJobs?.bind(options.monque),
          ),
        ),
    ),
    retryJobs: managementImplementer.retryJobs.handler(
      async ({ input, context }) =>
        await Effect.runPromise(
          operations.bulkJobMutation(
            "retryBulk",
            input,
            getOpenApiManagementContext(context),
            options.monque.retryJobs?.bind(options.monque),
          ),
        ),
    ),
    deleteJobs: managementImplementer.deleteJobs.handler(
      async ({ input, context }) =>
        await Effect.runPromise(
          operations.bulkJobMutation(
            "deleteBulk",
            input,
            getOpenApiManagementContext(context),
            options.monque.deleteJobs?.bind(options.monque),
          ),
        ),
    ),
  });
};
