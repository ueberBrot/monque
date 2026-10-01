import type { JobSelector, PersistedJob } from "@monque/core";
import { ORPCError } from "@orpc/server";

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
  return {
    getCapabilities,
    requireAction: async (
      action: ManagementAction,
      context: TContext,
      target: ManagementActionTarget = {},
    ): Promise<void> => {
      requireAllowed(await getActionDenial(action, context, target));
    },
    // Processing and selected actions reject missing support before checking read-only mode.
    requireSupported: (action: ManagementAction): void => {
      if (!isManagementActionSupported(options.monque, action))
        throwForbidden("Unsupported action");
    },
    requireMutation: <TMutator>(
      action: Exclude<ManagementAction, "read">,
      mutate: TMutator | undefined,
    ): TMutator => {
      requireAllowed(getSupportDenial(action));
      if (mutate === undefined) throwForbidden("Unsupported action");
      return mutate;
    },
  };

  async function getCapabilities(
    context: TContext,
    processingTarget: ManagementActionTarget = {},
  ): Promise<CapabilitiesDto> {
    const readOnly = options.readOnly ?? false;
    const actions: CapabilityActionsDto = { ...DEFAULT_CAPABILITY_ACTIONS };
    const check = async (action: ManagementAction): Promise<void> => {
      actions[action] =
        (await getActionDenial(
          action,
          context,
          action === "pause" || action === "resume" ? processingTarget : {},
          isManagementActionSupported(options.monque, action),
        )) === undefined;
    };
    if (options.parallelCapabilityChecks) {
      await Promise.all(MANAGEMENT_ACTIONS.map(check));
    } else {
      for (const action of MANAGEMENT_ACTIONS) await check(action);
    }
    return { readOnly, actions };
  }

  async function getActionDenial(
    action: ManagementAction,
    context: TContext,
    target: ManagementActionTarget = {},
    supported = true,
  ): Promise<string | undefined> {
    const denial = getSupportDenial(action, supported);
    if (denial !== undefined) return denial;
    if (
      options.authorize &&
      !(await options.authorize({
        action,
        context,
        job: target.job,
        selector: target.selector,
        ids: target.ids,
        ...(target.name === undefined ? {} : { name: target.name }),
        ...(target.instanceId === undefined ? {} : { instanceId: target.instanceId }),
      }))
    ) {
      return action === "read" ? "Read access denied" : "Action denied";
    }
    return undefined;
  }

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

function requireAllowed(denial: string | undefined): void {
  if (denial !== undefined) throwForbidden(denial);
}

function throwForbidden(message: string): never {
  throw new ORPCError("FORBIDDEN", { message });
}
