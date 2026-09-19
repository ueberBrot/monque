import type { JobSelector, PersistedJob } from '@monque/core';

import type {
	CapabilitiesDto,
	CapabilityActionsDto,
	ManagementAction,
	ManagementMonque,
	ManagementOptions,
} from './types.js';

const MANAGEMENT_ACTIONS = [
	'read',
	'cancel',
	'cancelBulk',
	'retry',
	'retryBulk',
	'reschedule',
	'delete',
	'deleteBulk',
] as const;

const DEFAULT_CAPABILITY_ACTIONS = {
	read: false,
	cancel: false,
	cancelBulk: false,
	retry: false,
	retryBulk: false,
	reschedule: false,
	delete: false,
	deleteBulk: false,
} satisfies CapabilityActionsDto & Record<(typeof MANAGEMENT_ACTIONS)[number], boolean>;

export interface ManagementActionTarget {
	job?: PersistedJob | undefined;
	selector?: JobSelector | undefined;
	ids?: readonly string[] | undefined;
}

export type ManagementActionDecision = { allowed: true } | { allowed: false; message: string };

export async function getManagementCapabilities<TContext>(
	options: ManagementOptions<TContext>,
	context: TContext,
): Promise<CapabilitiesDto> {
	const readOnly = options.readOnly ?? false;
	const actions: CapabilityActionsDto = { ...DEFAULT_CAPABILITY_ACTIONS };

	const check = async (action: ManagementAction): Promise<void> => {
		const decision = await decideManagementAction(options, action, context, {
			supported: isManagementActionSupported(options.monque, action),
		});

		actions[action] = decision.allowed;
	};
	if (options.parallelCapabilityChecks) {
		await Promise.all(MANAGEMENT_ACTIONS.map(check));
	} else {
		for (const action of MANAGEMENT_ACTIONS) await check(action);
	}

	return {
		readOnly,
		actions,
	};
}

export async function decideManagementAction<TContext>(
	options: ManagementOptions<TContext>,
	action: ManagementAction,
	context: TContext,
	input: ManagementActionTarget & { supported?: boolean } = {},
): Promise<ManagementActionDecision> {
	const supportDecision = decideManagementActionSupport(options, action, input.supported ?? true);

	if (!supportDecision.allowed) {
		return supportDecision;
	}

	if (await isAllowedByAuthorization(options, action, context, input)) {
		return { allowed: true };
	}

	return {
		allowed: false,
		message: action === 'read' ? 'Read access denied' : 'Action denied',
	};
}

export function decideManagementActionSupport<TContext>(
	options: ManagementOptions<TContext>,
	action: ManagementAction,
	supported = true,
): ManagementActionDecision {
	if (options.readOnly && action !== 'read') {
		return { allowed: false, message: 'Management surface is read-only' };
	}

	if (!supported) {
		return { allowed: false, message: 'Unsupported action' };
	}

	return { allowed: true };
}

export function isManagementActionSupported(
	monque: ManagementMonque,
	action: ManagementAction,
): boolean {
	switch (action) {
		case 'read':
			return true;
		case 'cancel':
			return Boolean(monque.cancelJob);
		case 'cancelBulk':
			return Boolean(monque.cancelJobs);
		case 'retry':
			return Boolean(monque.retryJob);
		case 'retryBulk':
			return Boolean(monque.retryJobs);
		case 'reschedule':
			return Boolean(monque.rescheduleJob);
		case 'delete':
			return Boolean(monque.deleteJob);
		case 'deleteBulk':
			return Boolean(monque.deleteJobs);
	}
}

async function isAllowedByAuthorization<TContext>(
	options: ManagementOptions<TContext>,
	action: ManagementAction,
	context: TContext,
	target: ManagementActionTarget,
): Promise<boolean> {
	if (!options.authorize) {
		return true;
	}

	return options.authorize({
		action,
		context,
		job: target.job,
		selector: target.selector,
		ids: target.ids,
	});
}
