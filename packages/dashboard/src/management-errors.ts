import { z } from 'zod';

const ErrorMessageSchema = z.string().min(1).optional().catch(undefined);
const ManagementErrorSchema = z.object({
	status: z.number().int().optional().catch(undefined),
	message: ErrorMessageSchema,
	data: z
		.object({
			error: ErrorMessageSchema,
			body: z.object({ error: ErrorMessageSchema }).optional().catch(undefined),
		})
		.optional()
		.catch(undefined),
});

function readManagementError(error: unknown): {
	status: number | undefined;
	message: string | undefined;
} {
	const parsed = ManagementErrorSchema.safeParse(error);
	if (!parsed.success) return { status: undefined, message: undefined };
	const { status, message, data } = parsed.data;
	return { status, message: data?.error ?? data?.body?.error ?? message };
}

type DashboardApiErrorState = {
	readonly title: string;
	readonly description: string;
	readonly tone: 'danger' | 'warning';
};

function resolveDashboardApiErrorState(error: unknown): DashboardApiErrorState {
	const { status, message } = readManagementError(error);

	switch (status) {
		case 401:
			return {
				title: 'Authentication required',
				description:
					message ??
					'Sign in through the host application, then reload this dashboard. Monque does not provide a separate Dashboard login screen.',
				tone: 'warning',
			};
		case 403:
			return {
				title: 'Access denied',
				description:
					message ??
					'Your current session is signed in, but it cannot view this Management surface.',
				tone: 'danger',
			};
		default:
			return {
				title: 'Dashboard data unavailable',
				description:
					message ??
					'Health and capability data could not be loaded. Confirm the Management API is reachable, then retry.',
				tone: 'danger',
			};
	}
}

function getQueryErrorMessage(error: unknown, fallback: string): string {
	return readManagementError(error).message ?? fallback;
}

function isUnauthorizedQueryError(error: unknown): boolean {
	return readManagementError(error).status === 401;
}

export {
	type DashboardApiErrorState,
	getQueryErrorMessage,
	isUnauthorizedQueryError,
	readManagementError,
	resolveDashboardApiErrorState,
};
