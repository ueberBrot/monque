export function getFieldErrors(errors: ReadonlyArray<unknown>): string | undefined {
	const messages = errors
		.flatMap((error) => {
			if (typeof error === 'string') return [error];
			if (
				error &&
				typeof error === 'object' &&
				'message' in error &&
				typeof error.message === 'string'
			)
				return [error.message];
			return [];
		})
		.filter(Boolean);
	return messages.length > 0 ? messages.join(', ') : undefined;
}
