import { format } from 'date-fns';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { parseDateTime } from '@/lib/dates';

import { useAppForm, withForm } from './form.js';

const draftDefaults = { date: '', time: '00:00' };

const DateTimeDraftFields = withForm({
	defaultValues: draftDefaults,
	props: { id: '', month: new Date(), onMonthChange: (_month: Date) => {} },
	render: function DateTimeDraftFields({ form, id, month, onMonthChange }) {
		return (
			<form.Subscribe selector={(state) => state.values}>
				{({ date, time }) => (
					<>
						<form.AppField
							name="date"
							listeners={{
								onChange: ({ value }) => {
									const parsed = parseDateTime(value, '12:00');
									if (parsed) onMonthChange(parsed);
								},
							}}
						>
							{(field) => (
								<>
									<field.CalendarField month={month} onMonthChange={onMonthChange} />
									<div className="grid grid-cols-[1.5fr_1fr] gap-3">
										<field.TextField
											id={`${id}-date`}
											label="Date"
											placeholder="YYYY-MM-DD"
											invalid={date.length > 0 && !parseDateTime(date, '12:00')}
										/>
										<form.AppField name="time">
											{(timeField) => (
												<timeField.TextField
													id={`${id}-time`}
													label="Time (24h)"
													placeholder="HH:mm"
													invalid={date.length > 0 && !parseDateTime(date, time)}
												/>
											)}
										</form.AppField>
									</div>
								</>
							)}
						</form.AppField>
						{date.length > 0 && !parseDateTime(date, time) ? (
							<p role="status" className="text-xs text-destructive">
								Enter a valid local date (YYYY-MM-DD) and time (HH:mm).
							</p>
						) : null}
					</>
				)}
			</form.Subscribe>
		);
	},
});

export function DateTimeEditor({
	id,
	value,
	allowClear,
	onApply,
}: {
	id: string;
	value: string;
	allowClear: boolean;
	onApply: (value: string) => void;
}) {
	const form = useAppForm({
		defaultValues: { date: value.slice(0, 10), time: value.slice(11, 16) || '00:00' },
		onSubmit: ({ value }) => {
			const draft = parseDateTime(value.date, value.time);
			if (draft) onApply(format(draft, "yyyy-MM-dd'T'HH:mm"));
		},
	});
	const [month, setMonth] = useState(
		() => parseDateTime(value.slice(0, 10), value.slice(11, 16)) ?? new Date(),
	);
	return (
		<form.AppForm>
			<DateTimeDraftFields form={form} id={id} month={month} onMonthChange={setMonth} />
			<div className="flex justify-between gap-2">
				{allowClear ? (
					<Button type="button" variant="ghost" onClick={() => onApply('')}>
						Clear
					</Button>
				) : null}
				<form.Subscribe selector={(state) => parseDateTime(state.values.date, state.values.time)}>
					{(draft) => (
						<Button
							type="button"
							className="ml-auto"
							disabled={!draft}
							onClick={() => {
								void form.handleSubmit();
							}}
						>
							Apply
						</Button>
					)}
				</form.Subscribe>
			</div>
		</form.AppForm>
	);
}
