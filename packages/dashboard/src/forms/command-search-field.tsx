import { useEffect, useRef } from 'react';

import { CommandInput } from '@/components/ui/command';

import { useFieldContext } from './context.js';

export function CommandSearchField({
	label,
	placeholder,
}: {
	label: string;
	placeholder?: string;
}) {
	const field = useFieldContext<string>();
	const inputRef = useRef<HTMLInputElement>(null);
	useEffect(() => {
		inputRef.current?.focus();
	}, []);
	return (
		<CommandInput
			ref={inputRef}
			name={field.name}
			aria-label={label}
			placeholder={placeholder}
			value={field.state.value}
			onValueChange={field.handleChange}
			onBlur={field.handleBlur}
		/>
	);
}
