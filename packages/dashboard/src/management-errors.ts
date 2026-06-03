type DashboardApiErrorState = {
	readonly title: string;
	readonly description: string;
	readonly tone: 'danger' | 'warning';
};

function resolveDashboardApiErrorState(error: unknown): DashboardApiErrorState {
	const status = getErrorStatus(error);
	const message = getErrorMessage(error);

	if (status === 401) {
		return {
			title: 'Authentication required',
			description:
				message ??
				'Sign in through the host application, then reload this dashboard. Monque does not provide a separate Dashboard login screen.',
			tone: 'warning',
		};
	}

	if (status === 403) {
		return {
			title: 'Access denied',
			description:
				message ?? 'Your current session is signed in, but it cannot view this Management surface.',
			tone: 'danger',
		};
	}

	return {
		title: 'Dashboard data unavailable',
		description:
			message ??
			'Health and capability data could not be loaded. Confirm the Management API is reachable, then retry.',
		tone: 'danger',
	};
}

function getErrorStatus(error: unknown): number | undefined {
	if (typeof error !== 'object' || error === null) {
		return undefined;
	}

	const status = Reflect.get(error, 'status');
	return typeof status === 'number' ? status : undefined;
}

function getErrorMessage(error: unknown): string | undefined {
	if (typeof error !== 'object' || error === null) {
		return error instanceof Error ? error.message : undefined;
	}

	const data = Reflect.get(error, 'data');

	if (typeof data === 'object' && data !== null) {
		const body = Reflect.get(data, 'body');

		if (typeof body === 'object' && body !== null) {
			const nestedError = Reflect.get(body, 'error');

			if (typeof nestedError === 'string' && nestedError.length > 0) {
				return nestedError;
			}
		}
	}

	const message = Reflect.get(error, 'message');
	return typeof message === 'string' && message.length > 0 ? message : undefined;
}

export { type DashboardApiErrorState, resolveDashboardApiErrorState };
