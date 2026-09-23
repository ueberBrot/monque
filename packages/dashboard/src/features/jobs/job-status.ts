import type { JobDto } from '@monque/management/contract';

export const JOB_STATUS_META = {
	pending: { label: 'Pending', badgeVariant: 'outline' },
	processing: { label: 'Processing', badgeVariant: 'info' },
	completed: { label: 'Completed', badgeVariant: 'success' },
	failed: { label: 'Failed', badgeVariant: 'danger' },
	cancelled: { label: 'Cancelled', badgeVariant: 'outline' },
} as const satisfies Record<JobDto['status'], { label: string; badgeVariant: string }>;
