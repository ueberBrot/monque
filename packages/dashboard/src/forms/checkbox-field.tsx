import { useId } from 'react';

import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';

import { useFieldContext } from './context.js';
import { getFieldErrors } from './field-errors.js';

type CheckboxFieldProps = {
	label: string;
	description?: string;
	bare?: boolean;
	indeterminate?: boolean;
};

export function CheckboxField({
	description,
	label,
	bare = false,
	indeterminate = false,
}: CheckboxFieldProps) {
	const field = useFieldContext<boolean>();
	const error = getFieldErrors(field.state.meta.errors);
	const fieldId = useId();

	const control = (
		<Checkbox
			id={fieldId}
			name={field.name}
			aria-label={label}
			checked={Boolean(field.state.value)}
			indeterminate={indeterminate}
			onBlur={field.handleBlur}
			onCheckedChange={field.handleChange}
		/>
	);
	if (bare) return control;
	return (
		<Field data-invalid={Boolean(error)}>
			<div className="flex items-center gap-2">
				{control}
				<FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
			</div>
			{description ? <FieldDescription>{description}</FieldDescription> : null}
			{error ? <FieldError>{error}</FieldError> : null}
		</Field>
	);
}
