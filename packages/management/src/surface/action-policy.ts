import type { JobSelector, PersistedJob } from "@monque/core";
import { ORPCError } from "@orpc/server";
import * as Effect from "effect/Effect";

import { concurrently, fromPromise } from "../effects.js";
import type {
  CapabilitiesDto,
  CapabilityActionsDto,
  ManagementAction,
  ManagementAuthorizationInput,
  ManagementMonque,
  ManagementOptions,
} from "./types.js";

const DEFAULT_CAPABILITY_ACTIONS = {
  read: false,
  cancel: false,
  cancelBulk: false,
  retry: false,
  retryBulk: false,
  reschedule: false,
  setJobPriority: false,
  delete: false,
  deleteBulk: false,
  pause: false,
  resume: false,
} satisfies CapabilityActionsDto & Record<ManagementAction, boolean>;
const MANAGEMENT_ACTIONS = [
  "read",
  "cancel",
  "cancelBulk",
  "retry",
  "retryBulk",
  "reschedule",
  "setJobPriority",
  "delete",
  "deleteBulk",
  "pause",
  "resume",
] as const satisfies readonly ManagementAction[];

interface ManagementActionTarget {
  name?: string | undefined;
  instanceId?: string | undefined;
  job?: PersistedJob | undefined;
  selector?: JobSelector | undefined;
  ids?: readonly string[] | undefined;
}

const forbidden = function forbidden(message: string) {
  return Effect.fail(new ORPCError("FORBIDDEN", { message }));
};

const requireAllowed = function requireAllowed(denial: string | undefined) {
  return denial === undefined ? Effect.void : forbidden(denial);
};

const isManagementActionSupported = function isManagementActionSupported(
  monque: ManagementMonque,
  action: ManagementAction,
): boolean {
  switch (action) {
    case "read": {
      return true;
    }
    case "pause":
    case "resume": {
      return monque.getProcessingState !== undefined && monque[action] !== undefined;
    }
    case "cancel": {
      return monque.cancelJob !== undefined;
    }
    case "cancelBulk": {
      return monque.cancelJobs !== undefined;
    }
    case "retry": {
      return monque.retryJob !== undefined;
    }
    case "retryBulk": {
      return monque.retryJobs !== undefined;
    }
    case "setJobPriority": {
      return monque.setJobPriority !== undefined;
    }
    case "reschedule": {
      return monque.rescheduleJob !== undefined;
    }
    case "delete": {
      return monque.deleteJob !== undefined;
    }
    case "deleteBulk": {
      return monque.deleteJobs !== undefined;
    }
    default: {
      return false;
    }
  }
};

/** Shares capability decisions and enforcement for one mounted Management Surface. */
export const createManagementActionPolicy = function createManagementActionPolicy<TContext>(
  options: ManagementOptions<TContext>,
) {
  const getSupportDenial = function getSupportDenial(
    action: ManagementAction,
    supported = true,
  ): string | undefined {
    if (options.readOnly === true && action !== "read") {
      return "Management surface is read-only";
    }
    return supported ? undefined : "Unsupported action";
  };

  const getActionDenial = Effect.fnUntraced(function* getActionDenial(
    action: ManagementAction,
    context: TContext,
    target: ManagementActionTarget = {},
    supported?: boolean,
  ) {
    const denial = getSupportDenial(action, supported ?? true);
    if (denial !== undefined) {
      return denial;
    }
    if (
      options.authorize &&
      !(yield* fromPromise(async () => {
        const input: ManagementAuthorizationInput<TContext> = {
          action,
          context,
          job: target.job,
          selector: target.selector,
          ids: target.ids,
        };
        if (target.name !== undefined) {
          input.name = target.name;
        }
        if (target.instanceId !== undefined) {
          input.instanceId = target.instanceId;
        }
        // oxlint-disable-next-line typescript/no-non-null-assertion -- Authorization is checked before this callback runs; keep the original receiver.
        return await options.authorize!(input);
      }))
    ) {
      return action === "read" ? "Read access denied" : "Action denied";
    }
    return denial;
  });

  const requireAction = Effect.fnUntraced(function* requireAction(
    action: ManagementAction,
    context: TContext,
    target: ManagementActionTarget = {},
  ) {
    yield* requireAllowed(yield* getActionDenial(action, context, target));
  });
  const requireSupported = Effect.fnUntraced(function* requireSupported(action: ManagementAction) {
    // Processing and selected actions reject missing support before checking read-only mode.
    if (!isManagementActionSupported(options.monque, action)) {
      return yield* forbidden("Unsupported action");
    }
    return yield* Effect.void;
  });
  const requireMutation = Effect.fnUntraced(function* requireMutation<TMutator>(
    action: Exclude<ManagementAction, "read">,
    mutate: TMutator | undefined,
  ): Effect.fn.Return<TMutator, ORPCError<"FORBIDDEN", unknown>> {
    yield* requireAllowed(getSupportDenial(action));
    if (mutate === undefined) {
      return yield* forbidden("Unsupported action");
    }
    return mutate;
  });

  const getCapabilities = Effect.fnUntraced(function* getCapabilities(
    context: TContext,
    processingTarget: ManagementActionTarget = {},
  ): Effect.fn.Return<CapabilitiesDto, unknown> {
    const readOnly = options.readOnly ?? false;
    const actions: CapabilityActionsDto = { ...DEFAULT_CAPABILITY_ACTIONS };
    const check = Effect.fnUntraced(function* check(action: ManagementAction) {
      actions[action] =
        (yield* getActionDenial(
          action,
          context,
          action === "pause" || action === "resume" ? processingTarget : {},
          isManagementActionSupported(options.monque, action),
        )) === undefined;
    });
    yield* options.parallelCapabilityChecks === true
      ? concurrently(MANAGEMENT_ACTIONS.map(check))
      : // oxlint-disable-next-line unicorn/no-array-for-each -- Effect.forEach traverses Effects, not an Array callback.
        Effect.forEach(MANAGEMENT_ACTIONS, check, { discard: true });
    return { readOnly, actions };
  });

  return { getCapabilities, requireAction, requireSupported, requireMutation };
};
