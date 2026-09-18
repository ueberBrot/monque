import { describe, expect, test } from 'vitest';

import {
	createManagementJob,
	createManagementMonque,
	expectJsonResponse,
	getManagementJobById,
	handleManagementGet,
	handleManagementPost,
} from '@tests/unit/management-test-utils';
import { createManagementSurface, type ManagementPayloadSerializer } from '@/index';

describe('oRPC Management payload serialization', () => {
	describe.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])(
		'Job Name %s',
		(name) => {
			test.each(['list', 'detail', 'cancel', 'retry', 'reschedule'])(
				'redacts the %s response without exposing request context',
				async (route) => {
					const job = createManagementJob({ name, data: { token: 'payload-secret' } });
					const surface = createManagementSurface<{ token: string }>({
						monque: createManagementMonque({
							getJobsWithCursor: async () => ({
								jobs: [job],
								cursor: null,
								hasNextPage: false,
								hasPreviousPage: false,
							}),
							getJob: getManagementJobById(job),
							cancelJob: async () => ({ ...job, status: 'cancelled' }),
							retryJob: async () => ({ ...job, status: 'pending' }),
							rescheduleJob: async (_id, nextRunAt) => ({ ...job, nextRunAt }),
						}),
						serializePayload: async () => ({ redacted: true }),
						serializePayloadByJobName: {},
					});
					const context = { managementContext: { token: 'context-secret' } };
					const jobPath = `/api/v1/jobs/${job._id.toHexString()}`;
					let response: Response;

					if (route === 'list' || route === 'detail') {
						response = await handleManagementGet(
							surface,
							route === 'list' ? '/api/v1/jobs' : jobPath,
							context,
						);
					} else {
						response = await handleManagementPost(
							surface,
							`${jobPath}/actions/${route}`,
							route === 'reschedule' ? { nextRunAt: '2026-02-01T00:00:00.000Z' } : undefined,
							context,
						);
					}

					const expectedJob = expect.objectContaining({ name, payload: { redacted: true } });
					await expectJsonResponse(
						response,
						200,
						route === 'list'
							? { jobs: [expectedJob], cursor: null, hasNextPage: false, hasPreviousPage: false }
							: expectedJob,
					);
				},
			);

			test('returns only the original payload when no serializer is configured', async () => {
				const job = createManagementJob({ name, data: { visible: true } });
				const surface = createManagementSurface({
					monque: createManagementMonque({ getJob: getManagementJobById(job) }),
					serializePayloadByJobName: {},
				});

				const response = await handleManagementGet(
					surface,
					`/api/v1/jobs/${job._id.toHexString()}`,
					{
						managementContext: { token: 'context-secret' },
					},
				);

				await expectJsonResponse(
					response,
					200,
					expect.objectContaining({ name, payload: { visible: true } }),
				);
			});

			test('uses an explicit serializer in a null-prototype map', async () => {
				const job = createManagementJob({ name, data: { token: 'payload-secret' } });
				const serializers: Record<string, ManagementPayloadSerializer> = {
					[name]: async () => ({ source: 'job' }),
				};
				Object.setPrototypeOf(serializers, null);
				const surface = createManagementSurface({
					monque: createManagementMonque({ getJob: getManagementJobById(job) }),
					serializePayload: async () => ({ source: 'global' }),
					serializePayloadByJobName: serializers,
				});

				const response = await handleManagementGet(
					surface,
					`/api/v1/jobs/${job._id.toHexString()}`,
				);

				await expectJsonResponse(
					response,
					200,
					expect.objectContaining({ name, payload: { source: 'job' } }),
				);
			});
		},
	);

	test('ignores custom inherited serializers and falls back to the global serializer', async () => {
		const job = createManagementJob({ data: { token: 'payload-secret' } });
		const serializers: Record<string, ManagementPayloadSerializer> = {};
		Object.setPrototypeOf(serializers, {
			'send-email': async () => ({ source: 'inherited' }),
		});
		const surface = createManagementSurface({
			monque: createManagementMonque({ getJob: getManagementJobById(job) }),
			serializePayload: async () => ({ source: 'global' }),
			serializePayloadByJobName: serializers,
		});

		const response = await handleManagementGet(surface, `/api/v1/jobs/${job._id.toHexString()}`);

		await expectJsonResponse(
			response,
			200,
			expect.objectContaining({ payload: { source: 'global' } }),
		);
	});
});
