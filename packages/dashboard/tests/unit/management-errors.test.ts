import { ORPCError } from '@orpc/client';
import { describe, expect, it } from 'vitest';

import { getActionErrorFeedback } from '@/features/jobs/job-actions';
import { readManagementError, resolveDashboardApiErrorState } from '@/management-errors';

describe('Management error presentation', () => {
	it.each([
		new ORPCError('FORBIDDEN', { message: 'Forbidden', data: { error: 'Session has expired.' } }),
		{ status: 403, message: 'Forbidden', data: { body: { error: 'Session has expired.' } } },
	])('preserves the host message across queries, job details and actions', (error) => {
		expect(readManagementError(error)).toEqual({ status: 403, message: 'Session has expired.' });
		expect(resolveDashboardApiErrorState(error).description).toBe('Session has expired.');
		expect(resolveDashboardApiErrorState(error, 'job')).toMatchObject({
			code: 'forbidden',
			description: 'Session has expired.',
		});
		expect(getActionErrorFeedback(error)).toMatchObject({
			title: 'Action unavailable',
			description: 'Session has expired.',
		});
	});

	it('retains error status when the host sends malformed optional details', () => {
		const error = { status: 401, data: { error: 42, body: null }, message: '' };
		expect(readManagementError(error).status).toBe(401);
		expect(resolveDashboardApiErrorState(error, 'job').code).toBe('unauthorized');
		expect(readManagementError(error).message).toBeUndefined();
	});

	it.each([undefined, null, 'broken', 42, { data: { error: {} } }])(
		'uses contextual fallbacks for an unknown failure: %j',
		(error) => {
			expect(readManagementError(error).message).toBeUndefined();
			expect(resolveDashboardApiErrorState(error, 'job').code).toBe('error');
			expect(getActionErrorFeedback(error).title).toBe('Action failed');
		},
	);

	it.each(['health', 'jobs', 'job', 'queue-views'] as const)(
		'classifies access failures for %s without overriding host messages',
		(resource) => {
			for (const [status, code] of [
				[401, 'unauthorized'],
				[403, 'forbidden'],
			] as const) {
				expect(
					resolveDashboardApiErrorState(
						{ status, message: 'Host explanation' },
						resource,
						'Loading failed',
					),
				).toMatchObject({ code, description: 'Host explanation' });
				expect(
					resolveDashboardApiErrorState({ status }, resource, 'Loading failed').title,
				).not.toBe('Loading failed');
			}
		},
	);

	it('treats a missing Job differently from a missing collection endpoint', () => {
		expect(resolveDashboardApiErrorState({ status: 404 }, 'job')).toMatchObject({
			code: 'not-found',
			title: 'Job not found',
			tone: 'default',
		});
		for (const resource of ['health', 'jobs', 'queue-views'] as const) {
			expect(resolveDashboardApiErrorState({ status: 404 }, resource).code).toBe('error');
		}
	});

	it('retains a Queue View name only in generic failure headings', () => {
		expect(
			resolveDashboardApiErrorState({ status: 500 }, 'queue-views', 'email failed to load'),
		).toMatchObject({ title: 'email failed to load', code: 'error' });
		expect(
			resolveDashboardApiErrorState({ status: 403 }, 'queue-views', 'email failed to load').title,
		).toBe('Access denied');
	});

	it('preserves ordinary network error messages', () => {
		expect(readManagementError(new Error('Network unavailable')).message).toBe(
			'Network unavailable',
		);
	});
});
