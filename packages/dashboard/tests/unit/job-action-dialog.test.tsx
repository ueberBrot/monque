// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { JobActionDialog, type JobActionDialogState } from '@/features/jobs/job-action-dialog';
import { fromDateTimeLocalValue } from '@/lib/dates';

describe('Job action confirmation', () => {
	it.each(['single', 'bulk'] as const)(
		'submits an explicit UTC run time for %s rescheduling',
		(scope) => {
			const onConfirm = vi.fn();
			const state: JobActionDialogState = {
				action: 'reschedule',
				scope,
				jobIds: scope === 'single' ? ['job-a'] : ['job-a', 'job-b'],
				nextRunAt: '2026-12-03T14:30',
			};
			render(
				<JobActionDialog
					state={state}
					busy={false}
					onClose={vi.fn()}
					onNextRunAtChange={vi.fn()}
					onConfirm={onConfirm}
				/>,
			);
			expect(onConfirm).not.toHaveBeenCalled();
			fireEvent.click(screen.getByRole('button', { name: /Confirm reschedule/ }));
			expect(onConfirm).toHaveBeenCalledExactlyOnceWith({
				action: 'reschedule',
				jobIds: state.jobIds,
				nextRunAt: fromDateTimeLocalValue(state.nextRunAt),
			});
		},
	);

	it.each(['', '2026-02-30T14:30'])(
		'does not submit an absent or invalid run time: %s',
		(nextRunAt) => {
			const onConfirm = vi.fn();
			render(
				<JobActionDialog
					state={{ action: 'reschedule', scope: 'single', jobIds: ['job-a'], nextRunAt }}
					busy={false}
					onClose={vi.fn()}
					onNextRunAtChange={vi.fn()}
					onConfirm={onConfirm}
				/>,
			);
			const button = screen.getByRole('button', { name: 'Confirm reschedule job' });
			expect(button.hasAttribute('disabled')).toBe(true);
			fireEvent.click(button);
			expect(onConfirm).not.toHaveBeenCalled();
		},
	);
});
