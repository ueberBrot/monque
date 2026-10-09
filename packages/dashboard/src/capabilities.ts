import type { CapabilitiesDto, CapabilityActionsDto } from "@monque/management/contract";

const dashboardCapabilityActionLabels = {
  read: "Read access",
  cancel: "Cancel job",
  cancelBulk: "Cancel selected jobs",
  retry: "Retry job",
  retryBulk: "Retry selected jobs",
  reschedule: "Reschedule job",
  setJobPriority: "Change job priority",
  delete: "Delete job",
  deleteBulk: "Delete selected jobs",
  pause: "Pause processing",
  resume: "Resume processing",
} as const satisfies Record<keyof CapabilityActionsDto, string>;
const dashboardCapabilityActions = [
  "read",
  "cancel",
  "cancelBulk",
  "retry",
  "retryBulk",
  "reschedule",
  "setJobPriority",
  "delete",
  "deleteBulk",
] as const satisfies readonly (keyof CapabilityActionsDto)[];
type DashboardCapabilityAction = (typeof dashboardCapabilityActions)[number];
interface DashboardCapabilityState {
  readonly action: DashboardCapabilityAction;
  readonly available: boolean;
  readonly label: string;
  readonly reason: string;
}
const AVAILABLE_CAPABILITY_REASON = "Available to you.";
const READ_ONLY_CAPABILITY_REASON = "This dashboard is read-only.";
const UNAVAILABLE_CAPABILITY_REASON = "Your host application has not enabled this action for you.";
const listDashboardCapabilityStates = (
  capabilities: CapabilitiesDto,
): readonly DashboardCapabilityState[] =>
  dashboardCapabilityActions.map((action) => {
    const available = Boolean(capabilities.actions[action]);
    return {
      action,
      available,
      label: dashboardCapabilityActionLabels[action],
      reason: (() => {
        if (available) {
          return AVAILABLE_CAPABILITY_REASON;
        }
        if (capabilities.readOnly && action !== "read") {
          return READ_ONLY_CAPABILITY_REASON;
        }
        return UNAVAILABLE_CAPABILITY_REASON;
      })(),
    };
  });
export {
  type DashboardCapabilityAction,
  type DashboardCapabilityState,
  listDashboardCapabilityStates,
};
