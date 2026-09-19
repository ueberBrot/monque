import type { CapabilitiesDto, JobDto } from '@monque/management/contract';

import type { DashboardManagementApi } from '@/management-client';
import { readManagementError } from '@/management-errors';

const JOB_ACTION_ORDER = ['cancel', 'retry', 'reschedule', 'delete'] as const;
type JobActionKey = (typeof JOB_ACTION_ORDER)[number];
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
type JobActionRequest =
	| { readonly action: Exclude<JobActionKey, 'reschedule'> }
	| { readonly action: 'reschedule'; readonly nextRunAt: string };
type RunJobActionInput = JobActionRequest & { readonly jobId: string };
type RunJobActionsInput = JobActionRequest & { readonly jobIds: readonly string[] };
type JobActionsResult = {
	readonly action: JobActionKey;
	readonly count: number;
	readonly jobs: readonly JobDto[];
	readonly failed: string[];
	readonly firstError: unknown;
	readonly authorizationChanged: boolean;
};

async function runJobActions(
	managementApi: DashboardManagementApi,
	input: RunJobActionsInput,
): Promise<JobActionsResult> {
	if (input.jobIds.length === 0)
		return {
			action: input.action,
			count: 0,
			jobs: [],
			failed: [],
			firstError: undefined,
			authorizationChanged: false,
		};
	if (input.jobIds.length === 1) {
		const jobId = input.jobIds[0];
		if (jobId === undefined) throw new Error('Missing selected job');
		const job = await runJobAction(managementApi, { ...input, jobId });
		return {
			action: input.action,
			count: 1,
			jobs: job ? [job] : [],
			failed: [],
			firstError: undefined,
			authorizationChanged: false,
		};
	}
	const result = await managementApi.client.selectedJobActions(
		input.action === 'reschedule'
			? { action: input.action, ids: [...input.jobIds], nextRunAt: input.nextRunAt }
			: { action: input.action, ids: [...input.jobIds] },
	);
	const errors = new Map(result.errors.map((error) => [error.jobId, error]));
	const failed = input.jobIds.filter((id) => errors.has(id));
	const first = failed[0] ? errors.get(failed[0]) : undefined;
	return {
		action: input.action,
		count: result.count,
		jobs: [],
		failed,
		firstError: first ? { status: first.status, message: first.error } : undefined,
		authorizationChanged: result.errors.some((error) => error.status === 403),
	};
}

const JOB_ACTION_DEFINITIONS = {
	cancel: {
		label: 'Cancel',
		bulkCapability: 'cancelBulk',
		statuses: new Set<JobDto['status']>(['pending']),
		reason: 'Only pending jobs can be cancelled.',
		bulkReason: 'Bulk cancel requires every selected job to be pending.',
	},
	retry: {
		label: 'Retry',
		bulkCapability: 'retryBulk',
		statuses: new Set<JobDto['status']>(['failed', 'cancelled']),
		reason: 'Only failed or cancelled jobs can be retried.',
		bulkReason: 'Bulk retry requires every selected job to be failed or cancelled.',
	},
	reschedule: {
		label: 'Reschedule',
		bulkCapability: 'reschedule',
		statuses: new Set<JobDto['status']>(['pending']),
		reason: 'Only pending jobs can be rescheduled.',
		bulkReason: 'Bulk reschedule requires every selected job to be pending.',
	},
	delete: {
		label: 'Delete',
		bulkCapability: 'deleteBulk',
		statuses: new Set<JobDto['status']>(),
		reason: '',
		bulkReason: '',
	},
} as const satisfies Record<
	JobActionKey,
	{
		label: string;
		bulkCapability: keyof CapabilitiesDto['actions'];
		statuses: ReadonlySet<JobDto['status']>;
		reason: string;
		bulkReason: string;
	}
>;

function getJobActionAvailability(
	job: JobDto,
	capabilities: CapabilitiesDto | undefined,
	action: JobActionKey,
): JobActionAvailability {
	return getActionAvailability([job], capabilities, action, false);
}

function getBulkJobActionAvailability(
	jobs: readonly JobDto[],
	capabilities: CapabilitiesDto | undefined,
	action: JobActionKey,
): JobActionAvailability {
	return getActionAvailability(jobs, capabilities, action, true);
}

function getActionAvailability(
	jobs: readonly JobDto[],
	capabilities: CapabilitiesDto | undefined,
	action: JobActionKey,
	bulk: boolean,
): JobActionAvailability {
	if (!jobs.length) return { disabled: true, reason: 'Select at least one job on this page.' };
	const definition = JOB_ACTION_DEFINITIONS[action];
	if (
		!capabilities?.actions[action] ||
		(bulk && !capabilities.actions[definition.bulkCapability])
	) {
		return {
			disabled: true,
			reason: capabilities?.readOnly
				? 'This dashboard is read-only.'
				: 'Your host application has not enabled this action for you.',
		};
	}
	const statuses = definition.statuses;
	const enabled = action === 'delete' || jobs.every((job) => statuses.has(job.status));
	return {
		disabled: !enabled,
		reason: enabled ? null : bulk ? definition.bulkReason : definition.reason,
	};
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
): Promise<JobDto | undefined> {
	const params = { id: input.jobId };
	switch (input.action) {
		case 'cancel':
			return managementApi.client.cancelJob({ params });
		case 'retry':
			return managementApi.client.retryJob({ params });
		case 'reschedule':
			return managementApi.client.rescheduleJob({ params, body: { nextRunAt: input.nextRunAt } });
		case 'delete':
			await managementApi.client.deleteJob({ params });
			return undefined;
	}
}

export {
	getActionErrorFeedback,
	getActionSuccessFeedback,
	getBulkJobActionAvailability,
	getJobActionAvailability,
	JOB_ACTION_DEFINITIONS,
	JOB_ACTION_ORDER,
	type JobActionFeedback,
	type JobActionFeedbackTone,
	type JobActionKey,
	type JobActionRequest,
	type RunJobActionsInput,
	runJobActions,
};
