import type { JobDto } from '@monque/management/contract';

/** Manual retry and successful recurring runs reset the failure counter. */
function getJobAttemptCount(job: Pick<JobDto, 'failCount' | 'status'>): number {
	const hasCurrentOrSuccessfulAttempt = job.status === 'processing' || job.status === 'completed';
	return job.failCount + (hasCurrentOrSuccessfulAttempt ? 1 : 0);
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

function getJobRunLabel(job: Pick<JobDto, 'status'>): string {
	return job.status === 'pending' ? 'Next run' : 'Scheduled for';
}

export {
	formatPayloadForDisplay,
	getJobAttemptCount,
	getJobRunLabel,
	isEmptyPayload,
	isStructuredPayload,
	serializePayloadForClipboard,
};
