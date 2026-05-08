import type {
	CapabilitiesDto,
	CapabilityActionsDto,
	ManagementAction,
	ManagementMonque,
	ManagementOptions,
} from './types.js';

const ManagementActions = ['read', 'cancel', 'retry', 'reschedule', 'delete'] as const;

const DEFAULT_CAPABILITY_ACTIONS = {
	read: false,
	cancel: false,
	retry: false,
	reschedule: false,
	delete: false,
} satisfies CapabilityActionsDto & Record<(typeof ManagementActions)[number], boolean>;

export async function getManagementCapabilities<TContext>(
	options: ManagementOptions<TContext>,
	context: TContext,
): Promise<CapabilitiesDto> {
	const readOnly = options.readOnly ?? false;
	const actions: CapabilityActionsDto = { ...DEFAULT_CAPABILITY_ACTIONS };

	for (const action of ManagementActions) {
		actions[action] =
			isManagementActionSupported(options.monque, action) &&
			isManagementActionAllowedByReadOnlyMode(action, readOnly) &&
			(await isAllowedByAuthorization(options, action, context));
	}

	return {
		readOnly,
		actions,
	};
}

function isManagementActionSupported(monque: ManagementMonque, action: ManagementAction): boolean {
	switch (action) {
		case 'read':
			return true;
		case 'cancel':
			return Boolean(monque.cancelJob || monque.cancelJobs);
		case 'retry':
			return Boolean(monque.retryJob || monque.retryJobs);
		case 'reschedule':
			return Boolean(monque.rescheduleJob);
		case 'delete':
			return Boolean(monque.deleteJob || monque.deleteJobs);
	}
}

function isManagementActionAllowedByReadOnlyMode(
	action: ManagementAction,
	readOnly: boolean,
): boolean {
	return !readOnly || action === 'read';
}

async function isAllowedByAuthorization<TContext>(
	options: ManagementOptions<TContext>,
	action: ManagementAction,
	context: TContext,
): Promise<boolean> {
	if (!options.authorize) {
		return true;
	}

	return options.authorize({ action, context });
}
