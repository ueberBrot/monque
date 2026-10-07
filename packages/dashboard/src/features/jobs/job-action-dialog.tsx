import { useSelector } from "@tanstack/react-store";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useAppForm } from "@/forms";
import { fromDateTimeLocalValue } from "@/lib/dates";

import {
  getJobActionLabels,
  type JobActionDialogState,
  type RunJobActionsInput,
} from "./job-actions.js";

type JobActionDialogProps = {
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onConfirm: (input: RunJobActionsInput) => void;
  readonly state: JobActionDialogState | null;
};

function JobActionDialog({ state, ...props }: JobActionDialogProps) {
  return (
    <Dialog
      open={state !== null}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogContent>
        {state ? (
          <JobActionDialogForm
            key={`${state.action}:${state.scope}:${state.jobIds.join(",")}`}
            state={state}
            {...props}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function JobActionDialogForm({
  state,
  busy,
  onClose,
  onConfirm,
}: Omit<JobActionDialogProps, "state"> & { readonly state: JobActionDialogState }) {
  const form = useAppForm({
    defaultValues: { nextRunAt: state.nextRunAt, priority: state.priority ?? "" },
    onSubmit: ({ value }) => {
      if (busy) return;
      if (state.action === "reschedule") {
        const nextRunAt = fromDateTimeLocalValue(value.nextRunAt);
        if (!nextRunAt) return;
        onConfirm({ action: "reschedule", jobIds: state.jobIds, nextRunAt });
      } else if (state.action === "priority") {
        const priority = parsePriority(value.priority);
        if (priority === undefined) return;
        onConfirm({ action: "priority", jobIds: state.jobIds, priority });
      } else {
        onConfirm({ action: state.action, jobIds: state.jobIds });
      }
    },
  });
  const date = useSelector(form.store, (state) => state.values.nextRunAt);
  const priorityValue = useSelector(form.store, (state) => state.values.priority);
  const requiresPriority = state.action === "priority";
  const priority = parsePriority(priorityValue);
  const requiresDate = state.action === "reschedule";
  const nextRunAt = requiresDate ? fromDateTimeLocalValue(date) : undefined;
  const { actionLabel, confirmationLabel } = getJobActionLabels(state.action, state.scope);

  return (
    <form.AppForm>
      <DialogTitle>
        {actionLabel}
        {state.scope === "single" && requiresDate ? "" : "?"}
      </DialogTitle>
      <DialogDescription>{getDialogDescription(state, priority)}</DialogDescription>
      {state.scope === "single" ? (
        <div className="min-w-0 rounded-lg border border-border p-3">
          <p className="break-all text-sm font-medium">{state.jobName}</p>
          <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
            {state.jobIds[0]}
          </p>
        </div>
      ) : null}
      {requiresDate ? (
        <form.AppField name="nextRunAt">
          {(field) => (
            <field.DateTimeField
              id="job-action-next-run-at"
              label="Next run at"
              allowClear={false}
            />
          )}
        </form.AppField>
      ) : null}
      {requiresPriority ? (
        <form.AppField name="priority">
          {(field) => (
            <field.TextField
              id="job-action-priority"
              label="Priority"
              type="number"
              invalid={priority === undefined}
              description="Enter a whole number from -9007199254740991 to 9007199254740991. Higher values run first; 0 is normal."
            />
          )}
        </form.AppField>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Keep current state
        </Button>
        <Button
          type="button"
          variant={state.action === "delete" ? "destructive" : "default"}
          onClick={() => {
            void form.handleSubmit();
          }}
          disabled={
            busy || (requiresDate && !nextRunAt) || (requiresPriority && priority === undefined)
          }
        >
          {confirmationLabel}
        </Button>
      </div>
    </form.AppForm>
  );
}

function getDialogDescription(state: JobActionDialogState, priority?: number): string {
  const scopeText = state.scope === "single" ? "this job" : `${state.jobIds.length} selected jobs`;

  switch (state.action) {
    case "cancel":
      return `Confirm cancellation for ${scopeText}.`;
    case "retry":
      return `Confirm retry for ${scopeText}.`;
    case "reschedule":
      return `Choose a new run time for ${scopeText}.`;
    case "priority":
      return priority === undefined
        ? `Choose a new priority for ${scopeText}. Only pending jobs can be changed.`
        : `Set priority to ${priority} for ${scopeText}. Only pending jobs can be changed.`;
    case "delete":
      return `Delete is permanent. Confirm deletion for ${scopeText}.`;
  }
}

function parsePriority(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const priority = Number(value);
  return Number.isSafeInteger(priority) ? priority : undefined;
}

export { JobActionDialog, type JobActionDialogState };
