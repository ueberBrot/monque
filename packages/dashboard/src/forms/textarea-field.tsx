import { useId } from 'react';

import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';

import { useFieldContext } from './context.js';
import { getFieldErrors } from './field-errors.js';

type TextareaFieldProps = {
	label: string;
	description?: string;
	placeholder?: string;
	rows?: number;
};

export function TextareaField({ description, label, placeholder, rows }: TextareaFieldProps) {
	const field = useFieldContext<string>();
	const fieldId = useId();
	const error = getFieldErrors(field.state.meta.errors);

	return (
		<Field data-invalid={Boolean(error)}>
			<FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
			<Textarea
				id={fieldId}
				aria-invalid={Boolean(error)}
				name={field.name}
				value={field.state.value}
				placeholder={placeholder}
				rows={rows}
				onBlur={field.handleBlur}
				onChange={(event) => field.handleChange(event.currentTarget.value)}
			/>
			{description ? <FieldDescription>{description}</FieldDescription> : null}
			{error ? <FieldError>{error}</FieldError> : null}
		</Field>
	);
}
