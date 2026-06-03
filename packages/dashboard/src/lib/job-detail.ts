import { type ORPCError, toORPCError } from '@orpc/client';
import { format, parseISO } from 'date-fns';

type JobDetailState =
	| {
			readonly code: 'unauthorized';
			readonly description: string;
			readonly title: string;
	  }
	| {
			readonly code: 'forbidden';
			readonly description: string;
			readonly title: string;
	  }
	| {
			readonly code: 'not-found';
			readonly description: string;
			readonly title: string;
	  }
	| {
			readonly code: 'error';
			readonly description: string;
			readonly title: string;
	  };

function formatDashboardDate(value: string | null | undefined): string {
	if (!value) {
		return 'Not available';
	}

	return format(parseISO(value), "MMM d, yyyy 'at' HH:mm:ss");
}

function getOperatorTimeZoneLabel(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local time';
}

function getJobAttemptCount(failCount: number): number {
	return failCount + 1;
}

function isStructuredPayload(
	payload: unknown,
): payload is Record<string, unknown> | readonly unknown[] {
	return typeof payload === 'object' && payload !== null;
}

function isEmptyPayload(payload: unknown): boolean {
	if (payload === null || payload === '') {
		return true;
	}

	if (Array.isArray(payload)) {
		return payload.length === 0;
	}

	if (isStructuredPayload(payload)) {
		return Object.keys(payload).length === 0;
	}

	return false;
}

function serializePayloadForClipboard(payload: unknown): string {
	if (typeof payload === 'string') {
		return payload;
	}

	const serializedPayload = JSON.stringify(payload, null, 2);
	return serializedPayload ?? 'null';
}

function mapJobDetailError(error: unknown): JobDetailState {
	const orpcError = toORPCError(error);

	switch (orpcError.code) {
		case 'UNAUTHORIZED':
			return {
				code: 'unauthorized',
				title: 'Sign in required',
				description: readManagementErrorMessage(orpcError, 'Sign in to inspect this Job detail.'),
			};
		case 'FORBIDDEN':
			return {
				code: 'forbidden',
				title: 'Job detail is forbidden',
				description: readManagementErrorMessage(
					orpcError,
					'Your current Management session cannot read this Job detail.',
				),
			};
		case 'NOT_FOUND':
			return {
				code: 'not-found',
				title: 'Job not found',
				description: readManagementErrorMessage(
					orpcError,
					'The Job may have been deleted or the copied URL is stale.',
				),
			};
		default:
			return {
				code: 'error',
				title: 'Job detail could not be loaded',
				description: readManagementErrorMessage(
					orpcError,
					'Refresh the page or confirm the Management API is reachable.',
				),
			};
	}
}

function readManagementErrorMessage(
	error: ORPCError<string, unknown>,
	fallbackMessage: string,
): string {
	if (typeof error.data === 'object' && error.data !== null && Object.hasOwn(error.data, 'error')) {
		const message = Reflect.get(error.data, 'error');

		if (typeof message === 'string' && message.length > 0) {
			return message;
		}
	}

	return error.message || fallbackMessage;
}

export {
	formatDashboardDate,
	getJobAttemptCount,
	getOperatorTimeZoneLabel,
	isEmptyPayload,
	isStructuredPayload,
	type JobDetailState,
	mapJobDetailError,
	serializePayloadForClipboard,
};
