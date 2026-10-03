import type { JobSelector, PersistedJob } from "@monque/core";
import { ORPCError } from "@orpc/server";
import * as Effect from "effect/Effect";

import { concurrently, fromPromise } from "../effects.js";
import type {
  CapabilitiesDto,
  CapabilityActionsDto,
  ManagementAction,
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
  delete: false,
  deleteBulk: false,
  pause: false,
  resume: false,
} satisfies CapabilityActionsDto & Record<ManagementAction, boolean>;
const MANAGEMENT_ACTIONS = Object.keys(DEFAULT_CAPABILITY_ACTIONS) as ManagementAction[];

interface ManagementActionTarget {
  name?: string | undefined;
  instanceId?: string | undefined;
  job?: PersistedJob | undefined;
  selector?: JobSelector | undefined;
  ids?: readonly string[] | undefined;
}

/** Shares capability decisions and enforcement for one mounted Management Surface. */
export function createManagementActionPolicy<TContext>(options: ManagementOptions<TContext>) {
  const requireAction = Effect.fnUntraced(function* (
    action: ManagementAction,
    context: TContext,
    target: ManagementActionTarget = {},
  ) {
    yield* requireAllowed(yield* getActionDenial(action, context, target));
  });
  const requireSupported = Effect.fnUntraced(function* (action: ManagementAction) {
    // Processing and selected actions reject missing support before checking read-only mode.
    if (!isManagementActionSupported(options.monque, action)) {
      return yield* forbidden("Unsupported action");
    }
  });
  const requireMutation = Effect.fnUntraced(function* <TMutator>(
    action: Exclude<ManagementAction, "read">,
    mutate: TMutator | undefined,
  ): Effect.fn.Return<TMutator, ORPCError<"FORBIDDEN", unknown>> {
    yield* requireAllowed(getSupportDenial(action));
    if (mutate === undefined) return yield* forbidden("Unsupported action");
    return mutate;
  });

  const getCapabilities = Effect.fnUntraced(function* (
    context: TContext,
    processingTarget: ManagementActionTarget = {},
  ): Effect.fn.Return<CapabilitiesDto, unknown> {
    const readOnly = options.readOnly ?? false;
    const actions: CapabilityActionsDto = { ...DEFAULT_CAPABILITY_ACTIONS };
    const check = Effect.fnUntraced(function* (action: ManagementAction) {
      actions[action] =
        (yield* getActionDenial(
          action,
          context,
          action === "pause" || action === "resume" ? processingTarget : {},
          isManagementActionSupported(options.monque, action),
        )) === undefined;
    });
    if (options.parallelCapabilityChecks) {
      yield* concurrently(MANAGEMENT_ACTIONS.map(check));
    } else {
      yield* Effect.forEach(MANAGEMENT_ACTIONS, check, { discard: true });
    }
    return { readOnly, actions };
  });

  const getActionDenial = Effect.fnUntraced(function* (
    action: ManagementAction,
    context: TContext,
    target: ManagementActionTarget = {},
    supported = true,
  ) {
    const denial = getSupportDenial(action, supported);
    if (denial !== undefined) return denial;
    if (
      options.authorize &&
      !(yield* fromPromise(() =>
        options.authorize!({
          action,
          context,
          job: target.job,
          selector: target.selector,
          ids: target.ids,
          ...(target.name === undefined ? {} : { name: target.name }),
          ...(target.instanceId === undefined ? {} : { instanceId: target.instanceId }),
        }),
      ))
    ) {
      return action === "read" ? "Read access denied" : "Action denied";
    }
    return undefined;
  });

  return { getCapabilities, requireAction, requireSupported, requireMutation };

  function getSupportDenial(action: ManagementAction, supported = true): string | undefined {
    if (options.readOnly && action !== "read") return "Management surface is read-only";
    return supported ? undefined : "Unsupported action";
  }
}

function isManagementActionSupported(monque: ManagementMonque, action: ManagementAction): boolean {
  switch (action) {
    case "read":
      return true;
    case "pause":
    case "resume":
      return Boolean(monque.getProcessingState && monque[action]);
    case "cancel":
      return Boolean(monque.cancelJob);
    case "cancelBulk":
      return Boolean(monque.cancelJobs);
    case "retry":
      return Boolean(monque.retryJob);
    case "retryBulk":
      return Boolean(monque.retryJobs);
    case "reschedule":
      return Boolean(monque.rescheduleJob);
    case "delete":
      return Boolean(monque.deleteJob);
    case "deleteBulk":
      return Boolean(monque.deleteJobs);
  }
}

function requireAllowed(denial: string | undefined) {
  return denial === undefined ? Effect.void : forbidden(denial);
}

function forbidden(message: string) {
  return Effect.fail(new ORPCError("FORBIDDEN", { message }));
}
