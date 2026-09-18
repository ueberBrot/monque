import type { CapabilitiesDto, JobDto } from '@monque/management/contract';

import { Button } from '@/components/ui/button';

import { JobActionHelp } from './job-action-help.js';
import { getBulkJobActionAvailability, type JobActionKey } from './job-actions.js';

function JobsBulkActions({
	selectedJobs,
	capabilities,
	busy,
	openBulkDialog,
}: {
	readonly selectedJobs: readonly JobDto[];
	readonly capabilities: CapabilitiesDto | undefined;
	readonly busy: boolean;
	readonly openBulkDialog: (action: JobActionKey) => void;
}) {
	const selectedRowCount = selectedJobs.length;
	const bulkCancelAvailability = getBulkJobActionAvailability(selectedJobs, capabilities, 'cancel');
	const bulkRetryAvailability = getBulkJobActionAvailability(selectedJobs, capabilities, 'retry');
	const bulkRescheduleAvailability = getBulkJobActionAvailability(
		selectedJobs,
		capabilities,
		'reschedule',
	);
	const bulkDeleteAvailability = getBulkJobActionAvailability(selectedJobs, capabilities, 'delete');

	return (
		<>
			{selectedRowCount > 0 ? (
				<div className="flex flex-wrap items-center gap-2 border-b border-border bg-primary/5 px-4 py-3">
					<span className="mr-2 text-xs font-medium">{selectedRowCount} selected</span>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => openBulkDialog('cancel')}
						disabled={bulkCancelAvailability.disabled || busy}
						title={bulkCancelAvailability.reason ?? undefined}
					>
						Cancel selected jobs
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => openBulkDialog('retry')}
						disabled={bulkRetryAvailability.disabled || busy}
						title={bulkRetryAvailability.reason ?? undefined}
					>
						Retry selected jobs
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => openBulkDialog('reschedule')}
						disabled={bulkRescheduleAvailability.disabled || busy}
						title={bulkRescheduleAvailability.reason ?? undefined}
					>
						Reschedule selected jobs
					</Button>
					<Button
						type="button"
						variant="destructive"
						size="sm"
						onClick={() => openBulkDialog('delete')}
						disabled={bulkDeleteAvailability.disabled || busy}
						title={bulkDeleteAvailability.reason ?? undefined}
					>
						Delete selected jobs
					</Button>
					<JobActionHelp
						actions={[
							{ label: 'Cancel', reason: bulkCancelAvailability.reason },
							{ label: 'Retry', reason: bulkRetryAvailability.reason },
							{ label: 'Reschedule', reason: bulkRescheduleAvailability.reason },
							{ label: 'Delete', reason: bulkDeleteAvailability.reason },
						]}
					/>
				</div>
			) : null}
		</>
	);
}

export { JobsBulkActions };
