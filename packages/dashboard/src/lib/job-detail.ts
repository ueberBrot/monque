import type { JobDto } from '@monque/management/contract';

import { readManagementError } from '@/management-errors';

type JobDetailStateCode = 'unauthorized' | 'forbidden' | 'not-found' | 'error';

type JobDetailState = {
	readonly code: JobDetailStateCode;
	readonly description: string;
	readonly title: string;
};

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

function formatPayloadForDisplay(payload: unknown): string {
	if (typeof payload === 'string') {
		return payload;
	}

	return serializePayloadForClipboard(payload);
}

function serializePayloadForClipboard(payload: unknown): string {
	const serializedPayload = JSON.stringify(payload, null, 2);
	return serializedPayload ?? 'null';
}

function mapJobDetailError(error: unknown): JobDetailState {
	const { status, message } = readManagementError(error);

	switch (status) {
		case 401:
			return {
				code: 'unauthorized',
				title: 'Sign in required',
				description: message ?? 'Sign in to inspect this Job detail.',
			};
		case 403:
			return {
				code: 'forbidden',
				title: 'Job detail is forbidden',
				description: message ?? 'Your current Management session cannot read this Job detail.',
			};
		case 404:
			return {
				code: 'not-found',
				title: 'Job not found',
				description: message ?? 'The Job may have been deleted or the copied URL is stale.',
			};
		default:
			return {
				code: 'error',
				title: 'Job detail could not be loaded',
				description: message ?? 'Refresh the page or confirm the Management API is reachable.',
			};
	}
}

function getJobRunLabel(job: Pick<JobDto, 'status'>): string {
	return job.status === 'pending' ? 'Next run' : 'Scheduled for';
}

export {
	formatPayloadForDisplay,
	getJobAttemptCount,
	getJobRunLabel,
	isEmptyPayload,
	isStructuredPayload,
	type JobDetailState,
	mapJobDetailError,
	serializePayloadForClipboard,
};
