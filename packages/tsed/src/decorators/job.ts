import { StoreMerge, useDecorators } from '@tsed/core';
import { Injectable } from '@tsed/di';

import { MONQUE_METADATA } from '@/constants/constants.js';
import { MonqueTypes } from '@/constants/MonqueTypes.js';
import type { JobOptions } from '@/types/JobOptions.js';
import { getJobToken } from '@/utils/getJobToken.js';

/**
 * Decorator that registers a class as a Monque job handler.
 *
 * The decorated class must implement the `JobMethods` interface.
 *
 * @param name The unique name for this job
 * @param options Optional job configuration
 *
 * @example
 * ```typescript
 * @Job('send-email')
 * export class SendEmailJob implements JobMethods<EmailPayload> {
 *   async handle(data: EmailPayload, job: Job<EmailPayload>) {
 *     // Handle the job
 *   }
 * }
 * ```
 */
export function Job(name: string, options: JobOptions = {}) {
	const token = options.token ?? getJobToken(name);

	return useDecorators(
		StoreMerge(MONQUE_METADATA, {
			name,
			options,
		}),
		Injectable({
			token,
			type: MonqueTypes.JOB,
		}),
	);
}
