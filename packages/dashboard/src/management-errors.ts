type DashboardApiErrorState = {
	readonly title: string;
	readonly description: string;
	readonly tone: 'danger' | 'warning';
};

function resolveDashboardApiErrorState(error: unknown): DashboardApiErrorState {
	const status = getErrorStatus(error);
	const message = getErrorMessage(error);

	switch (status) {
		case 401:
			return {
				title: 'Authentication required',
				description:
					message ??
					'Sign in through the host application, then reload this dashboard. Monque does not provide a separate Dashboard login screen.',
				tone: 'warning',
			};
		case 403:
			return {
				title: 'Access denied',
				description:
					message ??
					'Your current session is signed in, but it cannot view this Management surface.',
				tone: 'danger',
			};
		default:
			return {
				title: 'Dashboard data unavailable',
				description:
					message ??
					'Health and capability data could not be loaded. Confirm the Management API is reachable, then retry.',
				tone: 'danger',
			};
	}
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
		return undefined;
	}

	return getNestedErrorMessage(error) ?? getNonEmptyString(Reflect.get(error, 'message'));
}

function getNestedErrorMessage(error: object): string | undefined {
	const data = Reflect.get(error, 'data');
	if (typeof data === 'object' && data !== null) {
		const body = Reflect.get(data, 'body');

		if (typeof body === 'object' && body !== null) {
			const nestedError = Reflect.get(body, 'error');

			return getNonEmptyString(nestedError);
		}
	}

	return undefined;
}

function getNonEmptyString(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function getQueryErrorMessage(error: unknown, fallback: string): string {
	const unauthorizedMessage = getUnauthorizedQueryErrorMessage(error);

	if (unauthorizedMessage) {
		return unauthorizedMessage;
	}

	if (error instanceof Error && error.message.length > 0) {
		return error.message;
	}

	return fallback;
}

function isUnauthorizedQueryError(error: unknown): boolean {
	return getRecordValue(error, 'status') === 401;
}

function getUnauthorizedQueryErrorMessage(error: unknown): string | undefined {
	if (!isUnauthorizedQueryError(error)) {
		return undefined;
	}

	const data = getRecordValue(error, 'data');
	const body = getRecordValue(data, 'body');
	const message = getRecordValue(body, 'error');

	if (typeof message === 'string' && message.length > 0) {
		return message;
	}

	return undefined;
}

function getRecordValue(value: unknown, key: string): unknown {
	if (!isRecord(value)) {
		return undefined;
	}

	return value[key];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

export {
	type DashboardApiErrorState,
	getQueryErrorMessage,
	isUnauthorizedQueryError,
	resolveDashboardApiErrorState,
};
