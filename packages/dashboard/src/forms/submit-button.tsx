import { useSelector } from '@tanstack/react-store';

import { Button } from '@/components/ui/button';

import { useFormContext } from './context.js';

export function SubmitButton({ label = 'Submit' }: { label?: string }) {
	const form = useFormContext();
	const canSubmit = useSelector(form.store, (state) => state.canSubmit);
	const isSubmitting = useSelector(form.store, (state) => state.isSubmitting);

	return (
		<Button type="submit" disabled={!canSubmit || isSubmitting}>
			{isSubmitting ? 'Submitting...' : label}
		</Button>
	);
}
