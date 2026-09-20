import { useId } from 'react';

import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';

import { useFieldContext } from './context.js';
import { getFieldErrors } from './field-errors.js';

type SelectFieldProps = {
	label: string;
	description?: string;
	placeholder?: string;
	id?: string;
	bare?: boolean;
	className?: string;
	options: ReadonlyArray<{ label: string; value: string }>;
};

export function SelectField({
	description,
	label,
	options,
	placeholder,
	id,
	bare = false,
	className,
}: SelectFieldProps) {
	const field = useFieldContext<string>();
	const generatedId = useId();
	const fieldId = id ?? generatedId;
	const error = getFieldErrors(field.state.meta.errors);

	const control = (
		<Select
			name={field.name}
			items={options}
			value={field.state.value}
			onValueChange={(value) => field.handleChange(value ?? '')}
		>
			<SelectTrigger
				id={fieldId}
				aria-label={label}
				className={className}
				aria-invalid={Boolean(error)}
				onBlur={field.handleBlur}
			>
				<SelectValue placeholder={placeholder} />
			</SelectTrigger>
			<SelectContent>
				{options.map((option) => (
					<SelectItem key={option.value} value={option.value}>
						{option.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
	if (bare) return control;
	return (
		<Field data-invalid={Boolean(error)}>
			<FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
			{control}
			{description ? <FieldDescription>{description}</FieldDescription> : null}
			{error ? <FieldError>{error}</FieldError> : null}
		</Field>
	);
}
