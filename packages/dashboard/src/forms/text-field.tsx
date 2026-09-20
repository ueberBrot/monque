import { useId } from 'react';

import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

import { useFieldContext } from './context.js';
import { getFieldErrors } from './field-errors.js';

type TextFieldProps = {
	label: string;
	description?: string;
	placeholder?: string;
	id?: string;
	type?: 'email' | 'password' | 'search' | 'text' | 'url';
	invalid?: boolean;
};

export function TextField({
	description,
	label,
	placeholder,
	type = 'text',
	id,
	invalid,
}: TextFieldProps) {
	const field = useFieldContext<string>();
	const generatedId = useId();
	const fieldId = id ?? generatedId;
	const error = getFieldErrors(field.state.meta.errors);

	return (
		<Field data-invalid={Boolean(error)}>
			<FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
			<Input
				id={fieldId}
				aria-invalid={invalid || Boolean(error)}
				name={field.name}
				type={type}
				value={field.state.value}
				placeholder={placeholder}
				onBlur={field.handleBlur}
				onChange={(event) => field.handleChange(event.currentTarget.value)}
			/>
			{description ? <FieldDescription>{description}</FieldDescription> : null}
			{error ? <FieldError>{error}</FieldError> : null}
		</Field>
	);
}
