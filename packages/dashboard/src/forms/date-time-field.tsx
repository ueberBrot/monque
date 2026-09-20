import { useId } from 'react';

import { DateTimePicker } from '@/components/date-time-picker';
import { Field, FieldLabel } from '@/components/ui/field';

import { useFieldContext } from './context.js';

export function DateTimeField({
	id,
	label,
	allowClear = true,
}: {
	id?: string;
	label: string;
	allowClear?: boolean;
}) {
	const field = useFieldContext<string>();
	const generatedId = useId();
	const fieldId = id ?? generatedId;
	return (
		<Field>
			<FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
			<DateTimePicker
				id={fieldId}
				label={label}
				value={field.state.value}
				onChange={field.handleChange}
				allowClear={allowClear}
			/>
		</Field>
	);
}
