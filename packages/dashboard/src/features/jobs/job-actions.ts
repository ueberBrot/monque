import type { CapabilitiesDto, JobDto } from '@monque/management/contract';

import type { DashboardManagementApi } from '@/management-client';
import { readManagementError } from '@/management-errors';

type JobActionKey = 'cancel' | 'delete' | 'reschedule' | 'retry';
type BulkJobActionKey = JobActionKey;
type JobActionAvailability = {
	readonly disabled: boolean;
	readonly reason: string | null;
};
type JobActionFeedback = {
	readonly description: string;
	readonly title: string;
	readonly tone: JobActionFeedbackTone;
};
type JobActionFeedbackTone = 'danger' | 'success' | 'warning';
type RunJobActionInput = {
	readonly action: JobActionKey;
	readonly jobId: string;
	readonly nextRunAt?: string;
};
type RunJobActionsInput = Omit<RunJobActionInput, 'jobId'> & {
	readonly jobIds: readonly string[];
};
type JobActionsResult = {
	readonly action: JobActionKey;
	readonly count: number;
	readonly failed: string[];
	readonly firstError: unknown;
};

const MAX_CONCURRENT_JOB_ACTIONS = 5;

async function runJobActions(
	managementApi: DashboardManagementApi,
	input: RunJobActionsInput,
): Promise<JobActionsResult> {
	async function runBatch(offset: number): Promise<PromiseSettledResult<JobActionKey>[]> {
		const batch = input.jobIds.slice(offset, offset + MAX_CONCURRENT_JOB_ACTIONS);
		if (batch.length === 0) return [];

		const results = await Promise.allSettled(
			batch.map((jobId) => runJobAction(managementApi, { ...input, jobId })),
		);
		return [...results, ...(await runBatch(offset + MAX_CONCURRENT_JOB_ACTIONS))];
	}

	const results = await runBatch(0);
	const failed = input.jobIds.filter((_, index) => results[index]?.status === 'rejected');
	const firstFailure = results.find((result) => result.status === 'rejected');
	return {
		action: input.action,
		count: results.length - failed.length,
		failed,
		firstError: firstFailure?.reason,
	};
}

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
				? 'This dashboard is read-only.'
				: 'Your host application has not enabled this action for you.',
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

	if (
		!capabilities?.actions[BULK_CAPABILITY_BY_ACTION[action]] ||
		!capabilities.actions[SINGLE_CAPABILITY_BY_ACTION[action]]
	) {
		return {
			disabled: true,
			reason: capabilities?.readOnly
				? 'This dashboard is read-only.'
				: 'Your host application has not enabled this action for you.',
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
	const { status, message } = readManagementError(error);

	switch (status) {
		case 409:
			return {
				tone: 'warning',
				title: 'State conflict',
				description:
					message ?? 'The job changed before this action completed. The view has been refreshed.',
			};
		case 404:
			return {
				tone: 'warning',
				title: 'Job not found',
				description:
					message ?? 'The selected job is no longer available. The view has been refreshed.',
			};
		case 403:
			return {
				tone: 'warning',
				title: 'Action unavailable',
				description: message ?? 'Your current Management session cannot run this action.',
			};
		default:
			return {
				tone: 'danger',
				title: 'Action failed',
				description:
					message ?? 'The Management API could not complete this action. Refresh and try again.',
			};
	}
}

async function runJobAction(
	managementApi: DashboardManagementApi,
	input: RunJobActionInput,
): Promise<JobActionKey> {
	switch (input.action) {
		case 'cancel':
			await managementApi.client.cancelJob({
				params: { id: input.jobId },
			});
			return input.action;
		case 'retry':
			await managementApi.client.retryJob({
				params: { id: input.jobId },
			});
			return input.action;
		case 'reschedule':
			await managementApi.client.rescheduleJob({
				params: { id: input.jobId },
				body: {
					nextRunAt: input.nextRunAt ?? new Date().toISOString(),
				},
			});
			return input.action;
		case 'delete':
			await managementApi.client.deleteJob({
				params: { id: input.jobId },
			});
			return input.action;
	}
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
	type JobActionFeedbackTone,
	type JobActionKey,
	type RunJobActionInput,
	type RunJobActionsInput,
	runJobAction,
	runJobActions,
};
