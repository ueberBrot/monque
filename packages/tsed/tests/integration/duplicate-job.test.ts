import type { Job } from '@monque/core';
import { afterEach, describe, expect, it } from 'vitest';

import { Worker, WorkerController } from '@/decorators';

import { bootstrapMonque, resetMonque } from './helpers/bootstrap.js';

describe('Duplicate Worker Validation', () => {
	afterEach(resetMonque);

	it('should throw error on duplicate job names', async () => {
		@WorkerController('duplicate')
		class DuplicateController1 {
			@Worker('job')
			async handler(_job: Job) {}
		}

		@WorkerController('duplicate')
		class DuplicateController2 {
			@Worker('job')
			async handler(_job: Job) {}
		}

		await expect(
			bootstrapMonque({
				imports: [DuplicateController1, DuplicateController2],
				connectionStrategy: 'db',
			}),
		).rejects.toThrow(/Duplicate job registration detected/);
	});
});
