import { useState } from 'react';

import { DateTimePicker } from '@/components/date-time-picker';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { fromDateTimeLocalValue } from '@/lib/dates';

import {
	JOB_ACTION_DEFINITIONS,
	type JobActionKey,
	type RunJobActionsInput,
} from './job-actions.js';

type JobActionDialogState = {
	readonly action: JobActionKey;
	readonly jobIds: readonly string[];
	readonly jobName?: string;
	readonly nextRunAt: string;
	readonly scope: 'bulk' | 'single';
};

type JobActionDialogProps = {
	readonly busy: boolean;
	readonly onClose: () => void;
	readonly onConfirm: (input: RunJobActionsInput) => void;
	readonly state: JobActionDialogState | null;
};

function JobActionDialog({ state, ...props }: JobActionDialogProps) {
	return (
		<Dialog
			open={state !== null}
			onOpenChange={(open) => {
				if (!open) props.onClose();
			}}
		>
			<DialogContent>
				{state ? (
					<JobActionDialogForm
						key={`${state.action}:${state.scope}:${state.jobIds.join(',')}`}
						state={state}
						{...props}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function JobActionDialogForm({
	state,
	busy,
	onClose,
	onConfirm,
}: Omit<JobActionDialogProps, 'state'> & { readonly state: JobActionDialogState }) {
	const [date, setDate] = useState(state.nextRunAt);
	const requiresDate = state.action === 'reschedule';
	const nextRunAt = requiresDate ? fromDateTimeLocalValue(date) : undefined;
	const noun = state.scope === 'single' ? 'job' : 'selected jobs';
	const label = JOB_ACTION_DEFINITIONS[state.action].label;

	function confirm(): void {
		if (busy) return;
		if (state.action === 'reschedule') {
			if (!nextRunAt) return;
			onConfirm({ action: 'reschedule', jobIds: state.jobIds, nextRunAt });
		} else {
			onConfirm({ action: state.action, jobIds: state.jobIds });
		}
	}

	return (
		<>
			<DialogTitle>
				{label} {noun}
				{state.scope === 'single' && requiresDate ? '' : '?'}
			</DialogTitle>
			<DialogDescription>{getDialogDescription(state)}</DialogDescription>
			{state.scope === 'single' ? (
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
						value={date}
						onChange={setDate}
					/>
				</Field>
			) : null}
			<div className="flex flex-wrap justify-end gap-2">
				<Button type="button" variant="outline" onClick={onClose}>
					Keep current state
				</Button>
				<Button
					type="button"
					variant={state.action === 'delete' ? 'destructive' : 'default'}
					onClick={confirm}
					disabled={busy || (requiresDate && !nextRunAt)}
				>
					Confirm {state.action} {noun}
				</Button>
			</div>
		</>
	);
}

function getDialogDescription(state: JobActionDialogState): string {
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

export { JobActionDialog, type JobActionDialogState };
