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
      <DialogContent
        className={
          state?.action === "priority"
            ? "max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md"
            : undefined
        }
      >
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
          {requiresPriority ? (
            <p className="mt-2 text-sm">
              Current priority: <span className="font-mono tabular-nums">{state.priority}</span>
            </p>
          ) : null}
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
        <form.AppField
          name="priority"
          validators={{
            onChange: ({ value }) => getPriorityError(value),
          }}
          listeners={{
            onBlur: ({ fieldApi }) => {
              void fieldApi.validate("change");
            },
          }}
        >
          {(field) => (
            <field.TextField
              id="job-action-priority"
              label="Priority"
              type="number"
              description="Use a whole number. The default is 0; positive values have higher priority and negative values have lower priority."
            />
          )}
        </form.AppField>
      ) : null}
      {requiresPriority ? (
        <div className="grid gap-2 text-sm text-muted-foreground">
          <p>
            Among due jobs with the same name, higher values are picked first. For example, 10 comes
            before 0, and 0 before -10.
          </p>
          <p>
            Scheduled times stay the same, and running jobs continue. Recurring jobs keep this
            priority for future runs.
          </p>
        </div>
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

function getPriorityError(value: string): string | undefined {
  if (!value.trim()) return "Enter a priority, such as 0, 10, or -10.";
  if (!Number.isInteger(Number(value))) return "Use a whole number, such as 0, 10, or -10.";
  if (!Number.isSafeInteger(Number(value))) {
    return "That number is too large. Use a value closer to 0, such as 10 or -10.";
  }
  return undefined;
}

export { JobActionDialog, type JobActionDialogState };
