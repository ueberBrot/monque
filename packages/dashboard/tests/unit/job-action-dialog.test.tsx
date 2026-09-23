// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { JobActionDialog, type JobActionDialogState } from '@/features/jobs/job-action-dialog';
import { fromDateTimeLocalValue } from '@/lib/dates';

describe('Job action confirmation', () => {
	it.each(['single', 'bulk'] as const)(
		'submits an explicit UTC run time for %s rescheduling',
		async (scope) => {
			const onConfirm = vi.fn();
			const state: JobActionDialogState = {
				action: 'reschedule',
				scope,
				jobIds: scope === 'single' ? ['job-a'] : ['job-a', 'job-b'],
				nextRunAt: '2026-12-03T14:30',
			};
			render(
				<JobActionDialog state={state} busy={false} onClose={vi.fn()} onConfirm={onConfirm} />,
			);
			expect(onConfirm).not.toHaveBeenCalled();
			fireEvent.click(screen.getByRole('button', { name: /Confirm reschedule/ }));
			await waitFor(() =>
				expect(onConfirm).toHaveBeenCalledExactlyOnceWith({
					action: 'reschedule',
					jobIds: state.jobIds,
					nextRunAt: fromDateTimeLocalValue(state.nextRunAt),
				}),
			);
		},
	);

	it('keeps an edited draft across refreshes and resets it when reopened', async () => {
		const onConfirm = vi.fn();
		const state: JobActionDialogState = {
			action: 'reschedule',
			scope: 'single',
			jobIds: ['job-a'],
			nextRunAt: '2026-12-03T14:30',
		};
		const props = { busy: false, onClose: vi.fn(), onConfirm };
		const { rerender } = render(<JobActionDialog {...props} state={state} />);
		fireEvent.click(screen.getByRole('button', { name: 'Next run at' }));
		fireEvent.change(await screen.findByLabelText('Time (24h)', {}, { timeout: 5_000 }), {
			target: { value: '16:45' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
		await waitFor(() => expect(screen.queryByLabelText('Time (24h)')).toBeNull());
		rerender(<JobActionDialog {...props} state={{ ...state }} />);
		fireEvent.click(screen.getByRole('button', { name: 'Confirm reschedule job' }));
		await waitFor(() =>
			expect(onConfirm).toHaveBeenLastCalledWith({
				action: 'reschedule',
				jobIds: ['job-a'],
				nextRunAt: fromDateTimeLocalValue('2026-12-03T16:45'),
			}),
		);
		rerender(<JobActionDialog {...props} state={null} />);
		rerender(<JobActionDialog {...props} state={state} />);
		fireEvent.click(screen.getByRole('button', { name: 'Confirm reschedule job' }));
		await waitFor(() =>
			expect(onConfirm).toHaveBeenLastCalledWith({
				action: 'reschedule',
				jobIds: ['job-a'],
				nextRunAt: fromDateTimeLocalValue(state.nextRunAt),
			}),
		);
	});

	it.each(['', '2026-02-30T14:30'])(
		'does not submit an absent or invalid run time: %s',
		(nextRunAt) => {
			const onConfirm = vi.fn();
			render(
				<JobActionDialog
					state={{ action: 'reschedule', scope: 'single', jobIds: ['job-a'], nextRunAt }}
					busy={false}
					onClose={vi.fn()}
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
