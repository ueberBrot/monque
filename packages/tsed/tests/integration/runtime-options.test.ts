import { type Job, MonqueError } from '@monque/core';
import { afterEach, describe, expect, it } from 'vitest';

import { JobController, Job as MonqueJob } from '@/decorators';

import { bootstrapMonque, resetMonque } from './helpers/bootstrap.js';

describe('runtime options', () => {
	afterEach(resetMonque);

	it('rejects invalid scheduler configuration during bootstrap', async () => {
		await expect(
			bootstrapMonque({
				connectionStrategy: 'db',
				monqueConfig: { workerConcurrency: Number.NaN },
			}),
		).rejects.toThrow(MonqueError);
	});

	it('rejects invalid concurrency supplied through a Job decorator', async () => {
		@JobController('invalid-options')
		class EphemeralInvalidOptionsController {
			@MonqueJob('job', { concurrency: -1 })
			async handler(_job: Job) {}
		}

		await expect(
			bootstrapMonque({ imports: [EphemeralInvalidOptionsController], connectionStrategy: 'db' }),
		).rejects.toThrow('concurrency');
	});
});
