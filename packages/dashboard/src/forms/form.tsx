import { createFormHook, createFormHookContexts } from '@tanstack/react-form';
import { useSelector } from '@tanstack/react-store';
import { useId } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
	Select,
	SelectItem,
	SelectPopup,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

const { fieldContext, formContext, useFieldContext, useFormContext } = createFormHookContexts();

type BaseFieldProps = {
	label: string;
	description?: string;
};

type TextFieldProps = BaseFieldProps & {
	placeholder?: string;
	type?: 'email' | 'password' | 'search' | 'text' | 'url';
};

type TextareaFieldProps = BaseFieldProps & {
	placeholder?: string;
	rows?: number;
};

type CheckboxFieldProps = BaseFieldProps;

type SelectFieldProps = BaseFieldProps & {
	placeholder?: string;
	options: ReadonlyArray<{
		label: string;
		value: string;
	}>;
};

function getFieldErrors(errors: ReadonlyArray<unknown>): string | undefined {
	const messages = errors.map((error) => String(error)).filter((message) => message.length > 0);
	return messages.length > 0 ? messages.join(', ') : undefined;
}

function TextField({ description, label, placeholder, type = 'text' }: TextFieldProps) {
	const field = useFieldContext<string>();
	const error = getFieldErrors(field.state.meta.errors);

	return (
		<Field invalid={Boolean(error)}>
			<FieldLabel>{label}</FieldLabel>
			<Input
				name={field.name}
				type={type}
				value={field.state.value}
				placeholder={placeholder}
				onBlur={field.handleBlur}
				onValueChange={(value) => field.handleChange(value)}
			/>
			{description ? <FieldDescription>{description}</FieldDescription> : null}
			{error ? <FieldError>{error}</FieldError> : null}
		</Field>
	);
}

function TextareaField({ description, label, placeholder, rows }: TextareaFieldProps) {
	const field = useFieldContext<string>();
	const error = getFieldErrors(field.state.meta.errors);

	return (
		<Field invalid={Boolean(error)}>
			<FieldLabel>{label}</FieldLabel>
			<Textarea
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

function CheckboxField({ description, label }: CheckboxFieldProps) {
	const field = useFieldContext<boolean>();
	const error = getFieldErrors(field.state.meta.errors);
	const fieldId = useId();

	return (
		<Field invalid={Boolean(error)}>
			<div className="flex items-center gap-2">
				<Checkbox
					id={fieldId}
					name={field.name}
					checked={field.state.value}
					onBlur={field.handleBlur}
					onCheckedChange={(checked) => field.handleChange(checked)}
				/>
				<FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
			</div>
			{description ? <FieldDescription>{description}</FieldDescription> : null}
			{error ? <FieldError>{error}</FieldError> : null}
		</Field>
	);
}

function SelectField({ description, label, options, placeholder }: SelectFieldProps) {
	const field = useFieldContext<string>();
	const error = getFieldErrors(field.state.meta.errors);

	return (
		<Field invalid={Boolean(error)}>
			<FieldLabel>{label}</FieldLabel>
			<Select
				name={field.name}
				value={field.state.value}
				onValueChange={(value) => field.handleChange(value ?? '')}
			>
				<SelectTrigger onBlur={field.handleBlur}>
					<SelectValue placeholder={placeholder} />
				</SelectTrigger>
				<SelectPopup>
					{options.map((option) => (
						<SelectItem key={option.value} value={option.value}>
							{option.label}
						</SelectItem>
					))}
				</SelectPopup>
			</Select>
			{description ? <FieldDescription>{description}</FieldDescription> : null}
			{error ? <FieldError>{error}</FieldError> : null}
		</Field>
	);
}

function SubmitButton({ label = 'Submit' }: { label?: string }) {
	const form = useFormContext();
	const canSubmit = useSelector(form.store, (state) => state.canSubmit);
	const isSubmitting = useSelector(form.store, (state) => state.isSubmitting);

	return (
		<Button type="submit" disabled={!canSubmit || isSubmitting}>
			{isSubmitting ? 'Submitting...' : label}
		</Button>
	);
}

const { useAppForm, withForm } = createFormHook({
	fieldComponents: {
		CheckboxField,
		SelectField,
		TextareaField,
		TextField,
	},
	fieldContext,
	formComponents: {
		SubmitButton,
	},
	formContext,
});

export { useAppForm, withForm };
