import { DateTimePicker } from '@/components/date-time-picker';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { fromDateTimeLocalValue } from '@/lib/dates';

import type { JobActionKey } from './job-actions.js';

type JobActionDialogState = {
	readonly action: JobActionKey;
	readonly jobIds: readonly string[];
	readonly jobName?: string;
	readonly nextRunAt: string;
	readonly scope: 'bulk' | 'single';
};

function JobActionDialog({
	busy,
	onClose,
	onConfirm,
	onNextRunAtChange,
	state,
}: {
	readonly busy: boolean;
	readonly onClose: () => void;
	readonly onConfirm: () => void;
	readonly onNextRunAtChange: (nextRunAt: string) => void;
	readonly state: JobActionDialogState | null;
}) {
	const open = state !== null;
	const requiresDate = state?.action === 'reschedule';
	const invalidDate =
		requiresDate && (!state.nextRunAt || fromDateTimeLocalValue(state.nextRunAt) === undefined);

	return (
		<Dialog open={open} onOpenChange={(nextOpen) => (!nextOpen ? onClose() : undefined)}>
			<DialogContent>
				<DialogTitle>{getDialogTitle(state)}</DialogTitle>
				<DialogDescription>{getDialogDescription(state)}</DialogDescription>
				{state?.scope === 'single' ? (
					<div className="min-w-0 rounded-lg border border-border p-3">
						<p className="break-all text-sm font-medium">{state.jobName}</p>
						<p className="mt-1 break-all font-mono text-xs text-muted-foreground">
							{state.jobIds[0]}
						</p>
					</div>
				) : null}
				{requiresDate ? (
					<Field>
						<FieldLabel htmlFor="job-action-next-run-at">Next run at</FieldLabel>
						<DateTimePicker
							id="job-action-next-run-at"
							label="Next run at"
							allowClear={false}
							value={state?.nextRunAt ?? ''}
							onChange={onNextRunAtChange}
						/>
					</Field>
				) : null}
				<div className="flex flex-wrap justify-end gap-2">
					<Button type="button" variant="outline" onClick={onClose}>
						Keep current state
					</Button>
					<Button
						type="button"
						variant={state?.action === 'delete' ? 'destructive' : 'default'}
						onClick={onConfirm}
						disabled={busy || invalidDate}
					>
						{getDialogConfirmLabel(state)}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

function getDialogTitle(state: JobActionDialogState | null): string {
	if (!state) {
		return '';
	}

	switch (state.action) {
		case 'cancel':
			return 'Cancel selected jobs?';
		case 'retry':
			return 'Retry selected jobs?';
		case 'reschedule':
			return state.scope === 'single' ? 'Reschedule job' : 'Reschedule selected jobs?';
		case 'delete':
			return state.scope === 'single' ? 'Delete job?' : 'Delete selected jobs?';
	}
}

function getDialogDescription(state: JobActionDialogState | null): string {
	if (!state) {
		return '';
	}

	const scopeText = state.scope === 'single' ? 'this job' : `${state.jobIds.length} selected jobs`;

	switch (state.action) {
		case 'cancel':
			return `Confirm cancellation for ${scopeText}.`;
		case 'retry':
			return `Confirm retry for ${scopeText}.`;
		case 'reschedule':
			return `Choose a new run time for ${scopeText}.`;
		case 'delete':
			return `Delete is permanent. Confirm deletion for ${scopeText}.`;
	}
}

function getDialogConfirmLabel(state: JobActionDialogState | null): string {
	if (!state) {
		return '';
	}

	switch (state.action) {
		case 'cancel':
			return 'Confirm cancel selected jobs';
		case 'retry':
			return 'Confirm retry selected jobs';
		case 'reschedule':
			return state.scope === 'single'
				? 'Confirm reschedule job'
				: 'Confirm reschedule selected jobs';
		case 'delete':
			return state.scope === 'single' ? 'Confirm delete job' : 'Confirm delete selected jobs';
	}
}

export { JobActionDialog, type JobActionDialogState };
