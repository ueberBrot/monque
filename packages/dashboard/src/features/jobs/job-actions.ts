import type { CapabilitiesDto, JobDto } from '@monque/management/contract';
import { toORPCError } from '@orpc/client';

type JobActionKey = 'cancel' | 'delete' | 'reschedule' | 'retry';
type BulkJobActionKey = 'cancel' | 'delete' | 'reschedule' | 'retry';
type JobActionAvailability = {
	readonly disabled: boolean;
	readonly reason: string | null;
};
type JobActionFeedback = {
	readonly description: string;
	readonly title: string;
	readonly tone: 'danger' | 'success' | 'warning';
};

const BULK_CAPABILITY_BY_ACTION = {
	cancel: 'cancelBulk',
	delete: 'deleteBulk',
	reschedule: 'reschedule',
	retry: 'retryBulk',
} as const;

const SINGLE_CAPABILITY_BY_ACTION = {
	cancel: 'cancel',
	delete: 'delete',
	reschedule: 'reschedule',
	retry: 'retry',
} as const;

function getJobActionAvailability(
	job: JobDto,
	capabilities: CapabilitiesDto | undefined,
	action: JobActionKey,
): JobActionAvailability {
	if (!capabilities?.actions[SINGLE_CAPABILITY_BY_ACTION[action]]) {
		return {
			disabled: true,
			reason: capabilities?.readOnly
				? 'Disabled by Management read-only mode.'
				: 'Unavailable for this Management surface or current authorization policy.',
		};
	}

	switch (action) {
		case 'cancel':
			return getAvailabilityForPredicate(
				job.status === 'pending',
				'Only pending jobs can be cancelled.',
			);
		case 'retry':
			return getAvailabilityForPredicate(
				job.status === 'failed' || job.status === 'cancelled',
				'Only failed or cancelled jobs can be retried.',
			);
		case 'reschedule':
			return getAvailabilityForPredicate(
				job.status === 'pending',
				'Only pending jobs can be rescheduled.',
			);
		case 'delete':
			return {
				disabled: false,
				reason: null,
			};
	}
}

function getBulkJobActionAvailability(
	jobs: readonly JobDto[],
	capabilities: CapabilitiesDto | undefined,
	action: BulkJobActionKey,
): JobActionAvailability {
	if (jobs.length === 0) {
		return {
			disabled: true,
			reason: 'Select at least one job on this page.',
		};
	}

	if (!capabilities?.actions[BULK_CAPABILITY_BY_ACTION[action]]) {
		return {
			disabled: true,
			reason: capabilities?.readOnly
				? 'Disabled by Management read-only mode.'
				: 'Unavailable for this Management surface or current authorization policy.',
		};
	}

	switch (action) {
		case 'cancel':
			return getAvailabilityForPredicate(
				jobs.every((job) => job.status === 'pending'),
				'Bulk cancel requires every selected job to be pending.',
			);
		case 'retry':
			return getAvailabilityForPredicate(
				jobs.every((job) => job.status === 'failed' || job.status === 'cancelled'),
				'Bulk retry requires every selected job to be failed or cancelled.',
			);
		case 'reschedule':
			return getAvailabilityForPredicate(
				jobs.every((job) => job.status === 'pending'),
				'Bulk reschedule requires every selected job to be pending.',
			);
		case 'delete':
			return {
				disabled: false,
				reason: null,
			};
	}
}

function getActionSuccessFeedback(action: JobActionKey, count = 1): JobActionFeedback {
	const noun = count === 1 ? 'job' : 'jobs';

	switch (action) {
		case 'cancel':
			return {
				tone: 'success',
				title: count === 1 ? 'Job cancelled' : 'Jobs cancelled',
				description: `${count} ${noun} updated successfully.`,
			};
		case 'retry':
			return {
				tone: 'success',
				title: count === 1 ? 'Job retried' : 'Jobs retried',
				description: `${count} ${noun} moved back to pending.`,
			};
		case 'reschedule':
			return {
				tone: 'success',
				title: count === 1 ? 'Job rescheduled' : 'Jobs rescheduled',
				description: `${count} ${noun} received the new run time.`,
			};
		case 'delete':
			return {
				tone: 'success',
				title: count === 1 ? 'Job deleted' : 'Jobs deleted',
				description: `${count} ${noun} were removed from persistence.`,
			};
	}
}

function getActionErrorFeedback(error: unknown): JobActionFeedback {
	const orpcError = toORPCError(error);

	switch (orpcError.code) {
		case 'CONFLICT':
			return {
				tone: 'warning',
				title: 'State conflict',
				description:
					readActionErrorMessage(orpcError) ??
					'The job changed before this action completed. The view has been refreshed.',
			};
		case 'NOT_FOUND':
			return {
				tone: 'warning',
				title: 'Job not found',
				description:
					readActionErrorMessage(orpcError) ??
					'The selected job is no longer available. The view has been refreshed.',
			};
		case 'FORBIDDEN':
			return {
				tone: 'warning',
				title: 'Action unavailable',
				description:
					readActionErrorMessage(orpcError) ??
					'Your current Management session cannot run this action.',
			};
		default:
			return {
				tone: 'danger',
				title: 'Action failed',
				description:
					readActionErrorMessage(orpcError) ??
					'The Management API could not complete this action. Refresh and try again.',
			};
	}
}

function readActionErrorMessage(error: ReturnType<typeof toORPCError>): string | null {
	const data = error.data;

	if (typeof data === 'object' && data !== null && 'error' in data) {
		const message = data.error;

		if (typeof message === 'string' && message.length > 0) {
			return message;
		}
	}

	return error.message.length > 0 ? error.message : null;
}

function getAvailabilityForPredicate(enabled: boolean, reason: string): JobActionAvailability {
	return {
		disabled: !enabled,
		reason: enabled ? null : reason,
	};
}

export {
	type BulkJobActionKey,
	getActionErrorFeedback,
	getActionSuccessFeedback,
	getBulkJobActionAvailability,
	getJobActionAvailability,
	type JobActionFeedback,
	type JobActionKey,
};
