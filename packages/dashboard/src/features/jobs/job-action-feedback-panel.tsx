import { X } from "lucide-react";
import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";
import type { JobActionFeedback, JobActionFeedbackTone } from "@/features/jobs/job-actions";
import { cn } from "@/lib/utils";

const feedbackToneClasses = {
  danger: "bg-destructive/10 text-destructive",
  success: "bg-primary/10 text-foreground",
  warning: "bg-warning/10 text-warning-foreground-strong",
} satisfies Record<JobActionFeedbackTone, string>;
const getJobActionFeedbackToneClassName = (tone: JobActionFeedbackTone): string =>
  feedbackToneClasses[tone];
const JobActionFeedbackPanel = ({
  className,
  feedback,
  onDismiss,
}: {
  readonly className?: string;
  readonly onDismiss?: () => void;
  readonly feedback: JobActionFeedback;
}): ReactElement => (
  <output
    className={cn(
      "flex items-start justify-between gap-3 text-sm",
      getJobActionFeedbackToneClassName(feedback.tone),
      className,
    )}
  >
    <div>
      <p className="font-medium">{feedback.title}</p>
      <p className="text-current/80">{feedback.description}</p>
    </div>
    {onDismiss ? (
      <Button variant="ghost" size="icon" aria-label="Dismiss message" onClick={onDismiss}>
        <X className="size-4" />
      </Button>
    ) : null}
  </output>
);
export { JobActionFeedbackPanel };
