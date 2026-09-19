import type { JobDto } from '@monque/management/contract';
import { AlertTriangle, CalendarClock, CheckCircle2, CircleX, Clock3 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { JOB_STATUS_META } from '@/features/jobs/job-status';

const STATUS_ICONS = {
	pending: CalendarClock,
	processing: Clock3,
	completed: CheckCircle2,
	failed: AlertTriangle,
	cancelled: CircleX,
};

export function JobStatusBadge({
	status,
	withIcon = false,
}: {
	readonly status: JobDto['status'];
	readonly withIcon?: boolean;
}) {
	const meta = JOB_STATUS_META[status];
	const Icon = STATUS_ICONS[status];
	return (
		<Badge variant={meta.badgeVariant} className={withIcon ? 'h-7 gap-1.5 px-2.5' : undefined}>
			{withIcon ? <Icon className="size-3.5" /> : null}
			{meta.label}
		</Badge>
	);
}
