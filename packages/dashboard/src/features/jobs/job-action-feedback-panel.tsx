import type { ReactElement } from 'react';

import type { JobActionFeedback, JobActionFeedbackTone } from '@/features/jobs/job-actions';
import { cn } from '@/lib/utils';

function JobActionFeedbackPanel({
	className,
	feedback,
}: {
	readonly className?: string;
	readonly feedback: JobActionFeedback;
}): ReactElement {
	return (
		<section className={cn('text-sm', getJobActionFeedbackToneClassName(feedback.tone), className)}>
			<p className="font-medium">{feedback.title}</p>
			<p className="text-current/80">{feedback.description}</p>
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
			return 'bg-amber-500/10 text-amber-900 dark:text-amber-200';
	}
}

export { JobActionFeedbackPanel };
