import { useContext } from 'react';

import { SelectionFormContext } from './selection-form.js';

export function SelectionCheckbox({
	name,
	label,
	indeterminate = false,
	onChange,
}: {
	name: 'all' | `selected.${string}`;
	label: string;
	indeterminate?: boolean;
	onChange: (checked: boolean) => void;
}) {
	const form = useContext(SelectionFormContext);
	if (!form) throw new Error('Selection checkboxes require a selection form.');
	return (
		<form.AppField name={name} listeners={{ onChange: ({ value }) => onChange(value) }}>
			{(field) => <field.CheckboxField bare label={label} indeterminate={indeterminate} />}
		</form.AppField>
	);
}
