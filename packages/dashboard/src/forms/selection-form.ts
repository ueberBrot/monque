import { createContext, useEffect } from 'react';

import { useAppForm } from './form.js';

/** Share one selection form across the table header and all its rows. */
export function useSelectionForm(selected: Record<string, boolean>, all: boolean) {
	const form = useAppForm({ defaultValues: { selected, all } });
	useEffect(() => {
		form.reset({ selected, all });
	}, [form, selected, all]);
	return form;
}

export const SelectionFormContext = createContext<ReturnType<typeof useSelectionForm> | null>(null);
