import { X } from 'lucide-react';
import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import type { JobActionFeedback, JobActionFeedbackTone } from '@/features/jobs/job-actions';
import { cn } from '@/lib/utils';

function JobActionFeedbackPanel({
	className,
	feedback,
	onDismiss,
}: {
	readonly className?: string;
	readonly onDismiss?: () => void;
	readonly feedback: JobActionFeedback;
}): ReactElement {
	return (
		<section
			role="status"
			className={cn(
				'flex items-start justify-between gap-3 text-sm',
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
		</section>
	);
}

function getJobActionFeedbackToneClassName(tone: JobActionFeedbackTone): string {
	switch (tone) {
		case 'danger':
			return 'bg-destructive/10 text-destructive';
		case 'success':
			return 'bg-primary/10 text-foreground';
		case 'warning':
			return 'bg-warning/10 text-warning-foreground-strong';
	}
}

export { JobActionFeedbackPanel };
