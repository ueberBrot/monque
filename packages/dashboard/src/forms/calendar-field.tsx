import { format } from 'date-fns';
import { lazy, memo, Suspense, useCallback, useMemo } from 'react';

import { getOperatorTimeZoneLabel, parseDateTime } from '@/lib/dates';

import { useFieldContext } from './context.js';

const Calendar = memo(
	lazy(() => import('@/components/ui/calendar').then((module) => ({ default: module.Calendar }))),
);

export function CalendarField({
	month,
	onMonthChange,
}: {
	month: Date;
	onMonthChange: (month: Date) => void;
}) {
	const field = useFieldContext<string>();
	const selected = useMemo(() => parseDateTime(field.state.value, '12:00'), [field.state.value]);
	// Keep calendar props stable when text-field blur updates only form metadata.
	const { handleChange } = field;
	const selectDate = useCallback(
		(day: Date | undefined) => {
			if (day) handleChange(format(day, 'yyyy-MM-dd'));
		},
		[handleChange],
	);
	return (
		<Suspense
			fallback={
				<div className="h-72" role="status">
					Loading calendar…
				</div>
			}
		>
			<Calendar
				mode="single"
				timeZone={getOperatorTimeZoneLabel()}
				selected={selected}
				month={month}
				onMonthChange={onMonthChange}
				onSelect={selectDate}
				className="mx-auto p-0 [--cell-size:--spacing(9)]"
			/>
		</Suspense>
	);
}
