import type { PersistedJob } from '@monque/core';

import type { ManagementOptions, ManagementPayloadSerializer } from './types.js';

export async function serializeJobPayload<TContext>(
	options: ManagementOptions<TContext>,
	job: PersistedJob,
	context: TContext,
): Promise<unknown> {
	const serializePayload = getPayloadSerializer(options, job.name);

	if (!serializePayload) {
		return job.data;
	}

	return serializePayload({ job, payload: job.data, context });
}

function getPayloadSerializer<TContext>(
	options: ManagementOptions<TContext>,
	jobName: string,
): ManagementPayloadSerializer<TContext> | undefined {
	return options.serializePayloadByJobName?.[jobName] ?? options.serializePayload;
}
