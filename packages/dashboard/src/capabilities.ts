import type { CapabilitiesDto, CapabilityActionsDto } from '@monque/management/contract';

const dashboardCapabilityActionLabels = {
	read: 'Read access',
	cancel: 'Cancel job',
	cancelBulk: 'Cancel selected jobs',
	retry: 'Retry job',
	retryBulk: 'Retry selected jobs',
	reschedule: 'Reschedule job',
	delete: 'Delete job',
	deleteBulk: 'Delete selected jobs',
} as const satisfies Record<keyof CapabilityActionsDto, string>;

const dashboardCapabilityActions = [
	'read',
	'cancel',
	'cancelBulk',
	'retry',
	'retryBulk',
	'reschedule',
	'delete',
	'deleteBulk',
] as const satisfies readonly (keyof CapabilityActionsDto)[];

type DashboardCapabilityAction = (typeof dashboardCapabilityActions)[number];
type DashboardCapabilityState = {
	readonly action: DashboardCapabilityAction;
	readonly available: boolean;
	readonly label: string;
	readonly reason: string;
};

const AVAILABLE_CAPABILITY_REASON = 'Available in this Management surface.';
const READ_ONLY_CAPABILITY_REASON = 'Disabled by Management read-only mode.';
const UNAVAILABLE_CAPABILITY_REASON =
	'Unavailable for this Management surface or current authorization policy.';

function getDashboardCapabilityState(
	capabilities: CapabilitiesDto,
	action: DashboardCapabilityAction,
): DashboardCapabilityState {
	const available = capabilities.actions[action];

	if (available) {
		return {
			action,
			available,
			label: dashboardCapabilityActionLabels[action],
			reason: AVAILABLE_CAPABILITY_REASON,
		};
	}

	return {
		action,
		available,
		label: dashboardCapabilityActionLabels[action],
		reason: getUnavailableCapabilityReason(capabilities, action),
	};
}

function getUnavailableCapabilityReason(
	capabilities: CapabilitiesDto,
	action: DashboardCapabilityAction,
): string {
	if (capabilities.readOnly && action !== 'read') {
		return READ_ONLY_CAPABILITY_REASON;
	}

	return UNAVAILABLE_CAPABILITY_REASON;
}

function listDashboardCapabilityStates(
	capabilities: CapabilitiesDto,
): readonly DashboardCapabilityState[] {
	return dashboardCapabilityActions.map((action) =>
		getDashboardCapabilityState(capabilities, action),
	);
}

export {
	type DashboardCapabilityAction,
	type DashboardCapabilityState,
	dashboardCapabilityActions,
	getDashboardCapabilityState,
	listDashboardCapabilityStates,
};
