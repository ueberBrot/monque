import { ORPCError } from '@orpc/client';
import { describe, expect, it } from 'vitest';

import { getActionErrorFeedback } from '@/features/jobs/job-actions';
import { mapJobDetailError } from '@/lib/job-detail';
import {
	getQueryErrorMessage,
	isUnauthorizedQueryError,
	readManagementError,
	resolveDashboardApiErrorState,
} from '@/management-errors';

describe('Management error presentation', () => {
	it.each([
		new ORPCError('FORBIDDEN', { message: 'Forbidden', data: { error: 'Session has expired.' } }),
		{ status: 403, message: 'Forbidden', data: { body: { error: 'Session has expired.' } } },
	])('preserves the host message across queries, job details and actions', (error) => {
		expect(readManagementError(error)).toEqual({ status: 403, message: 'Session has expired.' });
		expect(resolveDashboardApiErrorState(error).description).toBe('Session has expired.');
		expect(mapJobDetailError(error)).toMatchObject({
			code: 'forbidden',
			description: 'Session has expired.',
		});
		expect(getActionErrorFeedback(error)).toMatchObject({
			title: 'Action unavailable',
			description: 'Session has expired.',
		});
		expect(getQueryErrorMessage(error, 'Fallback')).toBe('Session has expired.');
	});

	it('retains error status when the host sends malformed optional details', () => {
		const error = { status: 401, data: { error: 42, body: null }, message: '' };
		expect(isUnauthorizedQueryError(error)).toBe(true);
		expect(mapJobDetailError(error).code).toBe('unauthorized');
		expect(getQueryErrorMessage(error, 'Sign in')).toBe('Sign in');
	});

	it.each([undefined, null, 'broken', 42, { data: { error: {} } }])(
		'uses contextual fallbacks for an unknown failure: %j',
		(error) => {
			expect(getQueryErrorMessage(error, 'Fallback')).toBe('Fallback');
			expect(mapJobDetailError(error).code).toBe('error');
			expect(getActionErrorFeedback(error).title).toBe('Action failed');
		},
	);

	it('preserves ordinary network error messages', () => {
		expect(getQueryErrorMessage(new Error('Network unavailable'), 'Fallback')).toBe(
			'Network unavailable',
		);
	});
});
