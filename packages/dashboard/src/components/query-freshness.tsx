import { formatDistanceStrict } from "date-fns";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatDashboardDate } from "@/lib/dates";
import { useDocumentVisible } from "@/lib/document-visibility";
import { useNow } from "@/lib/use-now";

const QueryFreshness = ({
  updatedAt,
  fetching,
  pollingIntervalMs,
  paused = false,
}: {
  readonly updatedAt: number;
  readonly fetching: boolean;
  readonly pollingIntervalMs: number | undefined;
  readonly paused?: boolean;
}) => {
  const now = useNow();
  const visible = useDocumentVisible();
  const updated = new Date(updatedAt);
  const age = now.getTime() - updatedAt;
  const label =
    age < 30_000
      ? "Updated just now"
      : `Updated ${formatDistanceStrict(updated, now, { addSuffix: true })}`;
  return (
    <p className="text-xs text-muted-foreground" aria-live="off" aria-busy={fetching}>
      {updatedAt > 0 ? (
        <time dateTime={updated.toISOString()} title={formatDashboardDate(updated.toISOString())}>
          {label}
        </time>
      ) : (
        "Waiting for an update"
      )}
      {(() => {
        if (paused) {
          return " · Updates paused while offline";
        }
        if (visible) {
          if (
            pollingIntervalMs !== undefined &&
            pollingIntervalMs !== 0 &&
            !Number.isNaN(pollingIntervalMs)
          ) {
            return "";
          }
          return " · Auto-refresh off";
        }
        return " · Updates paused while hidden";
      })()}
    </p>
  );
};
const RefreshButton = ({
  onRefresh,
  fetching,
}: {
  readonly onRefresh: () => void;
  readonly fetching?: boolean;
}) => (
  <Button type="button" variant="outline" onClick={onRefresh} aria-busy={fetching}>
    <RefreshCw className="size-4" />
    Refresh
  </Button>
);
export { QueryFreshness, RefreshButton };
