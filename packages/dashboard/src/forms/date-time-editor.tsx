import { format } from 'date-fns';
import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { parseDateTime } from '@/lib/dates';

import { CalendarInput } from './calendar-field.js';

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
	const [date, setDate] = useState(value.slice(0, 10));
	const [time, setTime] = useState(value.slice(11, 16) || '00:00');
	const [month, setMonth] = useState(() => parseDateTime(date, time) ?? new Date());
	const changeDate = useCallback((value: string) => {
		setDate(value);
		const parsed = parseDateTime(value, '12:00');
		if (parsed) setMonth(parsed);
	}, []);
	const draft = parseDateTime(date, time);
	return (
		<>
			<CalendarInput value={date} onChange={changeDate} month={month} onMonthChange={setMonth} />
			<div className="grid grid-cols-[1.5fr_1fr] gap-3">
				<Field>
					<FieldLabel htmlFor={`${id}-date`}>Date</FieldLabel>
					<Input
						id={`${id}-date`}
						name="date"
						value={date}
						placeholder="YYYY-MM-DD"
						aria-invalid={date.length > 0 && !parseDateTime(date, '12:00')}
						onChange={(event) => changeDate(event.currentTarget.value)}
					/>
				</Field>
				<Field>
					<FieldLabel htmlFor={`${id}-time`}>Time (24h)</FieldLabel>
					<Input
						id={`${id}-time`}
						name="time"
						value={time}
						placeholder="HH:mm"
						aria-invalid={date.length > 0 && !draft}
						onChange={(event) => setTime(event.currentTarget.value)}
					/>
				</Field>
			</div>
			{date.length > 0 && !draft ? (
				<p role="status" className="text-xs text-destructive">
					Enter a valid local date (YYYY-MM-DD) and time (HH:mm).
				</p>
			) : null}
			<div className="flex justify-between gap-2">
				{allowClear ? (
					<Button type="button" variant="ghost" onClick={() => onApply('')}>
						Clear
					</Button>
				) : null}
				<Button
					type="button"
					className="ml-auto"
					disabled={!draft}
					onClick={() => {
						if (draft) onApply(format(draft, "yyyy-MM-dd'T'HH:mm"));
					}}
				>
					Apply
				</Button>
			</div>
		</>
	);
}
