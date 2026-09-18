import { format } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverTitle,
	PopoverTrigger,
} from '@/components/ui/popover';
import { getOperatorTimeZoneLabel, parseDateTime } from '@/lib/dates';

/** Local calendar/time editor composed from the generated shadcn components. */
function DateTimePicker({
	id,
	label,
	value,
	onChange,
	allowClear = true,
}: {
	readonly id: string;
	readonly label: string;
	readonly value: string;
	readonly onChange: (value: string) => void;
	readonly allowClear?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const [date, setDate] = useState('');
	const [time, setTime] = useState('00:00');
	const [month, setMonth] = useState(new Date());
	const selected = parseDateTime(date, '12:00');
	const draft = parseDateTime(date, time);
	const current = parseDateTime(value.slice(0, 10), value.slice(11, 16));
	const invalid = date.length > 0 && !draft;

	return (
		<Popover
			open={open}
			onOpenChange={(nextOpen) => {
				if (nextOpen) {
					setDate(value.slice(0, 10));
					setTime(value.slice(11, 16) || '00:00');
					setMonth(current ?? new Date());
				}
				setOpen(nextOpen);
			}}
		>
			<PopoverTrigger
				render={
					<Button
						id={id}
						aria-label={label}
						variant="outline"
						className="w-full justify-start text-left font-normal"
					>
						<CalendarIcon className="size-4 text-muted-foreground" />
						{current ? format(current, 'MMM d, yyyy · HH:mm') : 'Choose date and time'}
					</Button>
				}
			/>
			<PopoverContent
				align="start"
				collisionAvoidance={{ side: 'shift', align: 'shift' }}
				className="max-h-(--available-height) w-80 max-w-[calc(100vw-2rem)] gap-3 overflow-y-auto overscroll-contain p-3"
			>
				<div className="grid gap-1">
					<PopoverTitle>{label}</PopoverTitle>
					<PopoverDescription>Local time · {getOperatorTimeZoneLabel()}</PopoverDescription>
				</div>
				<Calendar
					mode="single"
					timeZone={getOperatorTimeZoneLabel()}
					selected={selected}
					month={month}
					onMonthChange={setMonth}
					onSelect={(day) => {
						if (day) setDate(format(day, 'yyyy-MM-dd'));
					}}
					className="mx-auto p-0 [--cell-size:--spacing(9)]"
				/>
				<div className="grid grid-cols-[1.5fr_1fr] gap-3">
					<Field>
						<FieldLabel htmlFor={`${id}-date`}>Date</FieldLabel>
						<Input
							id={`${id}-date`}
							placeholder="YYYY-MM-DD"
							value={date}
							aria-invalid={date.length > 0 && !selected}
							onChange={(event) => {
								const nextDate = event.target.value;
								setDate(nextDate);
								const parsed = parseDateTime(nextDate, '12:00');
								if (parsed) setMonth(parsed);
							}}
						/>
					</Field>
					<Field>
						<FieldLabel htmlFor={`${id}-time`}>Time (24h)</FieldLabel>
						<Input
							id={`${id}-time`}
							placeholder="HH:mm"
							value={time}
							aria-invalid={invalid}
							onChange={(event) => setTime(event.target.value)}
						/>
					</Field>
				</div>
				{invalid ? (
					<p role="status" className="text-xs text-destructive">
						Enter a valid local date (YYYY-MM-DD) and time (HH:mm).
					</p>
				) : null}
				<div className="flex justify-between gap-2">
					{allowClear ? (
						<Button
							variant="ghost"
							onClick={() => {
								onChange('');
								setOpen(false);
							}}
						>
							Clear
						</Button>
					) : null}
					<Button
						className="ml-auto"
						disabled={!draft}
						onClick={() => {
							if (!draft) return;
							onChange(format(draft, "yyyy-MM-dd'T'HH:mm"));
							setOpen(false);
						}}
					>
						Apply
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}

export { DateTimePicker };
