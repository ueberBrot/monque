import type {
  CapabilitiesDto,
  ProcessingActionDto,
  ProcessingStateDto,
} from "@monque/management/contract";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { Pause, Play } from "lucide-react";
import { useId } from "react";

import { useDocumentVisiblePollingInterval } from "@/lib/document-visibility";
import type { DashboardManagementApi } from "@/management-client";

import { Badge } from "./ui/badge.js";
import { Button } from "./ui/button.js";
import { Skeleton } from "./ui/skeleton.js";

export function ProcessingControls({
  managementApi,
  name,
  pollingIntervalMs,
}: {
  readonly managementApi: DashboardManagementApi;
  readonly name?: string;
  readonly pollingIntervalMs?: number | undefined;
}) {
  const descriptionId = useId();
  const queryClient = useQueryClient();
  const refetchInterval = useDocumentVisiblePollingInterval(pollingIntervalMs, 3);
  const input = name === undefined ? undefined : { name };
  const [stateQuery, capabilitiesQuery] = useQueries({
    queries: [
      {
        ...managementApi.orpc.processingState.queryOptions({ input }),
        refetchInterval,
        retry: false,
      },
      { ...managementApi.orpc.capabilities.queryOptions({ input }), refetchInterval, retry: false },
    ],
  });
  const mutation = useMutation({
    mutationFn: ({
      action,
      input: target,
    }: {
      action: "pause" | "resume";
      input: ProcessingActionDto;
    }) =>
      action === "pause"
        ? managementApi.client.pauseProcessing(target)
        : managementApi.client.resumeProcessing(target),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
    },
    onError: () => {
      void stateQuery.refetch();
      void capabilitiesQuery.refetch();
    },
  });
  const error = stateQuery.error ?? capabilitiesQuery.error;
  if (error)
    return (
      <section className="grid gap-2 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold">Processing</h2>
        <p className="text-sm text-muted-foreground">
          Could not load processing controls. {error.message}
        </p>
        <Button
          variant="outline"
          className="w-fit"
          onClick={() => {
            void stateQuery.refetch();
            void capabilitiesQuery.refetch();
          }}
        >
          Try again
        </Button>
      </section>
    );
  const state = stateQuery.data;
  const capabilities = capabilitiesQuery.data;
  if (!state || !capabilities)
    return <Skeleton className="h-28 w-full" aria-label="Loading processing state" />;
  const { action, disabled, reason } = processingControlState(state, capabilities, name);
  const scope = name === undefined ? "instance" : "worker";
  return (
    <section className="grid min-w-0 gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">Processing</h2>
          <Badge variant={state.paused ? "warning" : "outline"} aria-live="polite">
            {state.paused ? "Paused" : "Not paused"}
          </Badge>
        </div>
        <Button
          variant="outline"
          disabled={disabled || mutation.isPending}
          aria-describedby={descriptionId}
          onClick={() =>
            mutation.mutate({ action, input: { ...input, instanceId: state.instanceId } })
          }
        >
          {state.paused ? <Play /> : <Pause />}
          {mutation.isPending ? "Saving…" : `${state.paused ? "Resume" : "Pause"} ${scope}`}
        </Button>
      </div>
      <p className="break-all font-mono text-xs text-muted-foreground">
        Instance: {state.instanceId}
      </p>
      <p id={descriptionId} className="max-w-prose text-sm text-muted-foreground">
        {reason ?? "This instance only. Active jobs keep running."}
        {name === undefined && state.paused ? " Worker pauses stay in place." : ""}
      </p>
      {mutation.error ? (
        <p role="alert" className="text-sm text-destructive">
          {mutation.error.message}
        </p>
      ) : null}
    </section>
  );
}

function processingControlState(
  state: ProcessingStateDto,
  capabilities: CapabilitiesDto,
  name: string | undefined,
) {
  const action = state.paused ? "resume" : "pause";
  const globalPause = name !== undefined && state.globallyPaused;
  const allowed = capabilities.actions[action] ?? false;
  let reason: string | undefined;
  if (capabilities.readOnly) reason = "This dashboard is read-only.";
  else if (globalPause) reason = "Instance paused. Resume it from Health.";
  else if (!allowed) reason = `${state.paused ? "Resuming" : "Pausing"} is not allowed.`;
  return { action, disabled: !allowed || globalPause, reason } as const;
}
