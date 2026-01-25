import type { Job } from '@monque/core';
import { PlatformTest } from '@tsed/platform-http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Worker, WorkerController } from '@/decorators';
import { MonqueModule } from '@/monque-module';
import { MonqueService } from '@/services';

import { bootstrapMonque, resetMonque } from './helpers/bootstrap.js';
import { Server } from './helpers/Server.js';

describe('MonqueModule Lifecycle Integration', () => {
	afterEach(resetMonque);

	describe('Lifecycle (Mongoose Strategy)', () => {
		beforeEach(() => bootstrapMonque({ connectionStrategy: 'mongoose' }));

		it('should initialize and shutdown gracefully', async () => {
			const monqueService = PlatformTest.get<MonqueService>(MonqueService);
			expect(monqueService).toBeDefined();
		});
	});

	describe('Validation (Direct Db Strategy)', () => {
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

	describe('Configuration Error', () => {
		it('should throw if configuration is missing database strategy', async () => {
			const platform = PlatformTest.bootstrap(Server, {
				imports: [MonqueModule],
				monque: { enabled: true },
			});

			await expect(platform()).rejects.toThrow(
				"MonqueTsedConfig requires exactly one of 'db', 'dbFactory', or 'dbToken' to be set",
			);
		});
	});

	describe('Disabled Module', () => {
		beforeEach(() =>
			bootstrapMonque({
				connectionStrategy: 'dbFactory',
				monqueConfig: { enabled: false },
			}),
		);

		it('should not throw when module is disabled but service should throw on access', async () => {
			const monqueService = PlatformTest.get<MonqueService>(MonqueService);
			expect(monqueService).toBeDefined();
			await expect(monqueService.enqueue('test', {})).rejects.toThrow();
		});
	});
});
