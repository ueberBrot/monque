import type { CapabilitiesDto, JobDto } from "@monque/management/contract";

import { Button } from "@/components/ui/button";

import { JobActionHelp } from "./job-action-help.js";
import {
  getBulkJobActionAvailability,
  getJobActionLabels,
  JOB_ACTION_DEFINITIONS,
  JOB_ACTION_ORDER,
} from "./job-actions.js";
import type { JobActionKey } from "./job-actions.js";

const JobsBulkActions = ({
  selectedJobs,
  capabilities,
  busy,
  openBulkDialog,
}: {
  readonly selectedJobs: readonly JobDto[];
  readonly capabilities: CapabilitiesDto | undefined;
  readonly busy: boolean;
  readonly openBulkDialog: (action: JobActionKey) => void;
}) => {
  if (!selectedJobs.length) {
    return null;
  }
  const actions = JOB_ACTION_ORDER.map((action) => ({
    action,
    label: JOB_ACTION_DEFINITIONS[action].label,
    actionLabel: getJobActionLabels(action, "bulk").actionLabel,
    ...getBulkJobActionAvailability(selectedJobs, capabilities, action),
  }));
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-primary/5 px-4 py-3">
      <span className="mr-2 text-xs font-medium">{selectedJobs.length} selected</span>
      {actions.map(({ action, actionLabel, disabled, reason }) => (
        <Button
          key={action}
          type="button"
          size="sm"
          variant={action === "delete" ? "destructive" : "outline"}
          onClick={() => {
            openBulkDialog(action);
          }}
          disabled={disabled || busy}
          title={reason ?? undefined}
        >
          {actionLabel}
        </Button>
      ))}
      <JobActionHelp actions={actions} />
    </div>
  );
};
export { JobsBulkActions };
