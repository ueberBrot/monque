import { RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type DashboardStateTone = "default" | "danger" | "warning";
const DashboardState = ({
  title,
  description,
  tone = "default",
  children,
}: {
  readonly title: string;
  readonly description: string;
  readonly tone?: DashboardStateTone;
  readonly children?: ReactNode;
}) => {
  const hasChildren = Boolean(children);
  return (
    <section
      className={cn(
        "grid min-w-0 gap-4 rounded-xl border p-6",
        (() => {
          if (tone === "danger") {
            return "border-destructive/30 bg-destructive/10 text-destructive";
          }
          if (tone === "warning") {
            return "border-warning/30 bg-warning/10 text-warning-foreground";
          }
          return "border-border bg-card text-foreground";
        })(),
      )}
    >
      <div className="grid min-w-0 gap-2" role={tone === "default" ? undefined : "alert"}>
        <h1 className="text-lg font-semibold wrap-break-word">{title}</h1>
        <p
          className={cn(
            "max-w-prose text-sm wrap-break-word",
            tone === "default" && "text-muted-foreground",
          )}
        >
          {description}
        </p>
      </div>
      {hasChildren ? <div className="flex flex-wrap gap-2">{children}</div> : null}
    </section>
  );
};
const RetryButton = ({
  onRetry,
  fetching = false,
}: {
  readonly onRetry: () => void;
  readonly fetching?: boolean;
}) => (
  <Button
    type="button"
    variant="outline"
    onClick={onRetry}
    disabled={fetching}
    aria-busy={fetching}
  >
    <RefreshCw className="size-4" aria-hidden="true" />
    {fetching ? "Retrying…" : "Retry"}
  </Button>
);
export { DashboardState, RetryButton };
