import type { EffectWrapOptions, WithEffectContext } from "@orpc/effect";
/* oxlint-disable sonarjs/no-redundant-optional -- Native hook option getters can explicitly return undefined with exactOptionalPropertyTypes. */
import "@orpc/effect/extensions/effect";
import { implement, ORPCError, os } from "@orpc/server";
import type { ContractedRouter } from "@orpc/server";
import { Context, Effect } from "effect";

import { createManagementOperations } from "../compatibility.js";
import type { NativeManagementOptions } from "../native.js";
import type { ManagementOpenApiContext, ManagementOptions } from "../surface/index.js";
import { managementContract } from "./contract.js";
import type { ManagementContract } from "./contract.js";
import { createNativeManagementOperations } from "./operations.js";

/** oRPC router type returned by `createManagementRouter()`. */
export type ManagementRouter<TContext = unknown> = ContractedRouter<
  ManagementContract,
  ManagementOpenApiContext<TContext>
>;

const requiresOpenApiManagementContext = function requiresOpenApiManagementContext(options: {
  authorize?: unknown;
  serializePayload?: unknown;
  serializePayloadByJobName?: object | undefined;
}): boolean {
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
  return os
    .$context<ManagementOpenApiContext<TContext>>()
    .use(async ({ next }) => await next({ context: { "effect/context": Context.empty() } }))
    .router(createOperationsRouter(options, createManagementOperations(options)));
};

/** Native operations and hooks execute through the official oRPC Effect bridge.
 * Hosts supply effect/context, request Scope, and cancellation via the handler signal.
 */
export const createNativeManagementRouter = function createNativeManagementRouter<
  TContext = unknown,
  R = never,
>(options: NativeManagementOptions<TContext, R>) {
  return createOperationsRouter(options, createNativeManagementOperations(options));
};

const createOperationsRouter = function createOperationsRouter<TContext, R>(
  options: {
    authorize?: unknown;
    serializePayload?: unknown;
    serializePayloadByJobName?: object | undefined;
  },
  operations: ReturnType<typeof createNativeManagementOperations<TContext, R>>,
) {
  const managementImplementer = implement(managementContract)
    .$context<ManagementOpenApiContext<TContext> & WithEffectContext<R>>()
    .use(
      async ({ context, next }) =>
        await next({
          context: {
            // The official runner squashes Fail and Die alike; keep defects opaque at this seam.
            "effect/wrap": <A>(effect: Effect.Effect<A, unknown>, wrapOptions: EffectWrapOptions) =>
              Effect.suspend(() => context["effect/wrap"]?.(effect, wrapOptions) ?? effect).pipe(
                Effect.catchDefect((cause) =>
                  Effect.die(new Error("Management handler defect", { cause })),
                ),
              ),
          },
        }),
    );

  const requireContext = requiresOpenApiManagementContext(options);

  const getOpenApiManagementContext = function getOpenApiManagementContext(
    context: ManagementOpenApiContext<TContext>,
  ) {
    if (requireContext && context.managementContext === undefined) {
      return Effect.fail(
        new ORPCError("INTERNAL_SERVER_ERROR", {
          message:
            "Missing managementContext in openApiHandler.handle() context; managementContext is required for authorize/serializePayload hooks.",
        }),
      );
    }

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SAFETY: Missing context is permitted only when no hooks consume TContext; preserve the public generic adapter contract.
    return Effect.succeed(context.managementContext as TContext);
  };

  return managementImplementer.router({
    processingState: managementImplementer.processingState.effect(function* processingState({
      input,
      context,
    }) {
      return yield* operations.processingState(
        input?.name,
        yield* getOpenApiManagementContext(context),
      );
    }),
    pauseProcessing: managementImplementer.pauseProcessing.effect(function* pauseProcessing({
      input,
      context,
    }) {
      return yield* operations.processingAction(
        "pause",
        input,
        yield* getOpenApiManagementContext(context),
      );
    }),
    resumeProcessing: managementImplementer.resumeProcessing.effect(function* resumeProcessing({
      input,
      context,
    }) {
      return yield* operations.processingAction(
        "resume",
        input,
        yield* getOpenApiManagementContext(context),
      );
    }),
    selectedJobActions: managementImplementer.selectedJobActions.effect(
      function* selectedJobActions({ input, context }) {
        return yield* operations.selectedJobActions(
          input,
          yield* getOpenApiManagementContext(context),
        );
      },
    ),
    health: managementImplementer.health.effect(function* health() {
      return yield* operations.health();
    }),
    capabilities: managementImplementer.capabilities.effect(function* capabilities({
      input,
      context,
    }) {
      return yield* operations.capabilities(
        input?.name,
        yield* getOpenApiManagementContext(context),
      );
    }),
    queueViews: managementImplementer.queueViews.effect(function* queueViews({ input, context }) {
      return yield* operations.queueViews(input, yield* getOpenApiManagementContext(context));
    }),
    jobs: managementImplementer.jobs.effect(function* jobs({ input, context }) {
      return yield* operations.jobs(input, yield* getOpenApiManagementContext(context));
    }),
    jobStats: managementImplementer.jobStats.effect(function* jobStats({ input, context }) {
      return yield* operations.jobStats(input, yield* getOpenApiManagementContext(context));
    }),
    job: managementImplementer.job.effect(function* job({ input, context }) {
      return yield* operations.job(input.params.id, yield* getOpenApiManagementContext(context));
    }),
    cancelJob: managementImplementer.cancelJob.effect(function* cancelJob({ input, context }) {
      return yield* operations.mutateJob(
        { action: "cancel" },
        input.params.id,
        yield* getOpenApiManagementContext(context),
      );
    }),
    retryJob: managementImplementer.retryJob.effect(function* retryJob({ input, context }) {
      return yield* operations.mutateJob(
        { action: "retry" },
        input.params.id,
        yield* getOpenApiManagementContext(context),
      );
    }),
    rescheduleJob: managementImplementer.rescheduleJob.effect(function* rescheduleJob({
      input,
      context,
    }) {
      return yield* operations.mutateJob(
        { action: "reschedule", nextRunAt: input.body.nextRunAt },
        input.params.id,
        yield* getOpenApiManagementContext(context),
      );
    }),
    setJobPriority: managementImplementer.setJobPriority.effect(function* setJobPriority({
      input,
      context,
    }) {
      return yield* operations.mutateJob(
        { action: "setJobPriority", priority: input.body.priority },
        input.params.id,
        yield* getOpenApiManagementContext(context),
      );
    }),
    deleteJob: managementImplementer.deleteJob.effect(function* deleteJob({ input, context }) {
      return yield* operations.deleteJob(
        input.params.id,
        yield* getOpenApiManagementContext(context),
      );
    }),
    cancelJobs: managementImplementer.cancelJobs.effect(function* cancelJobs({ input, context }) {
      return yield* operations.bulkJobMutation(
        "cancelBulk",
        input,
        yield* getOpenApiManagementContext(context),
      );
    }),
    retryJobs: managementImplementer.retryJobs.effect(function* retryJobs({ input, context }) {
      return yield* operations.bulkJobMutation(
        "retryBulk",
        input,
        yield* getOpenApiManagementContext(context),
      );
    }),
    deleteJobs: managementImplementer.deleteJobs.effect(function* deleteJobs({ input, context }) {
      return yield* operations.bulkJobMutation(
        "deleteBulk",
        input,
        yield* getOpenApiManagementContext(context),
      );
    }),
  });
};
