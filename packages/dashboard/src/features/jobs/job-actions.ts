import type { CapabilitiesDto, JobDto } from "@monque/management/contract";

import { toDateTimeLocalValue } from "@/lib/dates";
import type { DashboardManagementApi } from "@/management-client";
import { readManagementError } from "@/management-errors";

const JOB_ACTION_ORDER = ["cancel", "retry", "reschedule", "priority", "delete"] as const;
type JobActionKey = (typeof JOB_ACTION_ORDER)[number];
interface JobActionAvailability {
  readonly disabled: boolean;
  readonly reason: string | null;
}
interface JobActionFeedback {
  readonly description: string;
  readonly title: string;
  readonly tone: JobActionFeedbackTone;
}
type JobActionFeedbackTone = "danger" | "success" | "warning";
type JobActionRequest =
  | {
      readonly action: Exclude<JobActionKey, "reschedule" | "priority">;
    }
  | {
      readonly action: "reschedule";
      readonly nextRunAt: string;
    }
  | {
      readonly action: "priority";
      readonly priority: number;
    };
type RunJobActionInput = JobActionRequest & {
  readonly jobId: string;
};
type RunJobActionsInput = JobActionRequest & {
  readonly jobIds: readonly string[];
};
interface JobActionsResult {
  readonly action: JobActionKey;
  readonly count: number;
  readonly jobs: readonly JobDto[];
  readonly failed: string[];
  readonly firstError: unknown;
  readonly authorizationChanged: boolean;
}
interface JobActionDialogState {
  readonly action: JobActionKey;
  readonly jobIds: readonly string[];
  readonly jobName?: string;
  readonly nextRunAt: string;
  readonly priority?: string;
  readonly scope: "bulk" | "single";
}
const prepareSingleJobAction = (
  action: JobActionKey,
  job: Pick<JobDto, "id" | "name" | "nextRunAt" | "priority">,
):
  | {
      readonly type: "confirm";
      readonly state: JobActionDialogState;
    }
  | {
      readonly type: "run";
      readonly input: RunJobActionsInput;
    } => {
  if (action === "delete" || action === "reschedule" || action === "priority") {
    return {
      type: "confirm",
      state: {
        action,
        jobIds: [job.id],
        jobName: job.name,
        nextRunAt: action === "reschedule" ? toDateTimeLocalValue(job.nextRunAt) : "",
        priority: action === "priority" ? String(job.priority) : "",
        scope: "single",
      },
    };
  }
  return { type: "run", input: { action, jobIds: [job.id] } };
};
const runJobAction = async (
  managementApi: DashboardManagementApi,
  input: RunJobActionInput,
): Promise<readonly JobDto[]> => {
  const params = { id: input.jobId };
  switch (input.action) {
    case "cancel": {
      return [await managementApi.client.cancelJob({ params })];
    }
    case "retry": {
      return [await managementApi.client.retryJob({ params })];
    }
    case "reschedule": {
      return [
        await managementApi.client.rescheduleJob({ params, body: { nextRunAt: input.nextRunAt } }),
      ];
    }
    case "priority": {
      return [
        await managementApi.client.setJobPriority({ params, body: { priority: input.priority } }),
      ];
    }
    case "delete": {
      await managementApi.client.deleteJob({ params });
      return [];
    }
    default: {
      throw new RangeError("Unsupported job action.");
    }
  }
};
const runJobActions = async (
  managementApi: DashboardManagementApi,
  input: RunJobActionsInput,
): Promise<JobActionsResult> => {
  if (input.jobIds.length === 0) {
    return {
      action: input.action,
      count: 0,
      jobs: [],
      failed: [],
      firstError: undefined,
      authorizationChanged: false,
    };
  }
  if (input.jobIds.length === 1) {
    const [jobId] = input.jobIds;
    if (jobId === undefined) {
      throw new Error("Missing selected job");
    }
    const jobs = await runJobAction(managementApi, { ...input, jobId });
    return {
      action: input.action,
      count: 1,
      jobs,
      failed: [],
      firstError: undefined,
      authorizationChanged: false,
    };
  }
  const result = await managementApi.client.selectedJobActions(
    (() => {
      if (input.action === "reschedule") {
        return { action: input.action, ids: [...input.jobIds], nextRunAt: input.nextRunAt };
      }
      if (input.action === "priority") {
        return { action: input.action, ids: [...input.jobIds], priority: input.priority };
      }
      return { action: input.action, ids: [...input.jobIds] };
    })(),
  );
  const errors = new Map(result.errors.map((error) => [error.jobId, error]));
  const failed = input.jobIds.filter((id) => errors.has(id));
  const first =
    failed[0] === undefined || failed[0] === null || failed[0] === ""
      ? undefined
      : errors.get(failed[0]);
  return {
    action: input.action,
    count: result.count,
    jobs: [],
    failed,
    firstError: first ? { status: first.status, message: first.error } : undefined,
    authorizationChanged: result.errors.some((error) => error.status === 403),
  };
};
const JOB_ACTION_DEFINITIONS = {
  cancel: {
    label: "Cancel",
    bulkCapability: "cancelBulk",
    statuses: new Set<JobDto["status"]>(["pending"]),
    reason: "Only pending jobs can be cancelled.",
    bulkReason: "Bulk cancel requires every selected job to be pending.",
  },
  retry: {
    label: "Retry",
    bulkCapability: "retryBulk",
    statuses: new Set<JobDto["status"]>(["failed", "cancelled"]),
    reason: "Only failed or cancelled jobs can be retried.",
    bulkReason: "Bulk retry requires every selected job to be failed or cancelled.",
  },
  reschedule: {
    label: "Reschedule",
    bulkCapability: "reschedule",
    statuses: new Set<JobDto["status"]>(["pending"]),
    reason: "Only pending jobs can be rescheduled.",
    bulkReason: "Bulk reschedule requires every selected job to be pending.",
  },
  priority: {
    label: "Change priority",
    bulkCapability: "setJobPriority",
    statuses: new Set<JobDto["status"]>(["pending"]),
    reason: "Only pending jobs can have their priority changed.",
    bulkReason: "Changing priority requires every selected job to be pending.",
  },
  delete: {
    label: "Delete",
    bulkCapability: "deleteBulk",
    statuses: new Set<JobDto["status"]>(),
    reason: "",
    bulkReason: "",
  },
} as const satisfies Record<
  JobActionKey,
  {
    label: string;
    bulkCapability: keyof CapabilitiesDto["actions"];
    statuses: ReadonlySet<JobDto["status"]>;
    reason: string;
    bulkReason: string;
  }
>;
const getJobActionLabels = (action: JobActionKey, scope: "bulk" | "single") => {
  if (action === "priority") {
    return {
      actionLabel: scope === "single" ? "Change job priority" : "Change priority for selected jobs",
      confirmationLabel:
        scope === "single" ? "Confirm priority change" : "Confirm priority changes",
    };
  }
  const noun = scope === "single" ? "job" : "selected jobs";
  return {
    actionLabel: `${JOB_ACTION_DEFINITIONS[action].label} ${noun}`,
    confirmationLabel: `Confirm ${action} ${noun}`,
  };
};
const getActionAvailability = (
  jobs: readonly JobDto[],
  capabilities: CapabilitiesDto | undefined,
  action: JobActionKey,
  bulk: boolean,
): JobActionAvailability => {
  if (!jobs.length) {
    return { disabled: true, reason: "Select at least one job on this page." };
  }
  const definition = JOB_ACTION_DEFINITIONS[action];
  if (
    capabilities?.actions[action === "priority" ? "setJobPriority" : action] !== true ||
    (bulk && capabilities.actions[definition.bulkCapability] !== true)
  ) {
    return {
      disabled: true,
      reason:
        capabilities?.readOnly === true
          ? "This dashboard is read-only."
          : "Your host application has not enabled this action for you.",
    };
  }
  const { statuses } = definition;
  const enabled = action === "delete" || jobs.every((job) => statuses.has(job.status));
  return {
    disabled: !enabled,
    reason: (() => {
      if (enabled) {
        return null;
      }
      if (bulk) {
        return definition.bulkReason;
      }
      return definition.reason;
    })(),
  };
};
const getJobActionAvailability = (
  job: JobDto,
  capabilities: CapabilitiesDto | undefined,
  action: JobActionKey,
): JobActionAvailability => getActionAvailability([job], capabilities, action, false);
const getBulkJobActionAvailability = (
  jobs: readonly JobDto[],
  capabilities: CapabilitiesDto | undefined,
  action: JobActionKey,
): JobActionAvailability => getActionAvailability(jobs, capabilities, action, true);
const getActionSuccessFeedback = (action: JobActionKey, count = 1): JobActionFeedback => {
  const noun = count === 1 ? "job" : "jobs";
  switch (action) {
    case "cancel": {
      return {
        tone: "success",
        title: count === 1 ? "Job cancelled" : "Jobs cancelled",
        description: `${count} ${noun} updated successfully.`,
      };
    }
    case "retry": {
      return {
        tone: "success",
        title: count === 1 ? "Job retried" : "Jobs retried",
        description: `${count} ${noun} moved back to pending.`,
      };
    }
    case "reschedule": {
      return {
        tone: "success",
        title: count === 1 ? "Job rescheduled" : "Jobs rescheduled",
        description: `${count} ${noun} received the new run time.`,
      };
    }
    case "priority": {
      return {
        tone: "success",
        title: count === 1 ? "Job priority changed" : "Job priorities changed",
        description: `${count} ${noun} received the new priority.`,
      };
    }
    case "delete": {
      return {
        tone: "success",
        title: count === 1 ? "Job deleted" : "Jobs deleted",
        description: `${count} ${noun} were removed from persistence.`,
      };
    }
    default: {
      throw new RangeError("Unsupported job action.");
    }
  }
};
const getActionErrorFeedback = (
  error: Parameters<typeof readManagementError>[0],
): JobActionFeedback => {
  const { status, message } = readManagementError(error);
  const fallback: JobActionFeedback = {
    tone: "danger",
    title: "Action failed",
    description:
      message ?? "The Management API could not complete this action. Refresh and try again.",
  };
  if (status === undefined) {
    return fallback;
  }
  switch (status) {
    case 409: {
      return {
        tone: "warning",
        title: "State conflict",
        description:
          message ?? "The job changed before this action completed. The view has been refreshed.",
      };
    }
    case 404: {
      return {
        tone: "warning",
        title: "Job not found",
        description:
          message ?? "The selected job is no longer available. The view has been refreshed.",
      };
    }
    case 403: {
      return {
        tone: "warning",
        title: "Action unavailable",
        description: message ?? "Your current Management session cannot run this action.",
      };
    }
    default: {
      return {
        tone: "danger",
        title: "Action failed",
        description:
          message ?? "The Management API could not complete this action. Refresh and try again.",
      };
    }
  }
};
export {
  getActionErrorFeedback,
  getActionSuccessFeedback,
  getBulkJobActionAvailability,
  getJobActionAvailability,
  getJobActionLabels,
  JOB_ACTION_DEFINITIONS,
  JOB_ACTION_ORDER,
  type JobActionDialogState,
  type JobActionFeedback,
  type JobActionFeedbackTone,
  type JobActionKey,
  type JobActionRequest,
  prepareSingleJobAction,
  type RunJobActionsInput,
  runJobActions,
};
