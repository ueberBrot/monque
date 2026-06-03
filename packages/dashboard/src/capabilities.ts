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
			reason: 'Available in this Management surface.',
		};
	}

	return {
		action,
		available,
		label: dashboardCapabilityActionLabels[action],
		reason:
			capabilities.readOnly && action !== 'read'
				? 'Disabled by Management read-only mode.'
				: 'Unavailable for this Management surface or current authorization policy.',
	};
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
