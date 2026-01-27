import type { Job } from '@monque/core';
import { InjectorService, LOGGER, ProviderScope, Scope } from '@tsed/di';
import { PlatformTest } from '@tsed/platform-http/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Worker, WorkerController } from '@/decorators';
import { MonqueModule } from '@/monque-module';
import { MonqueService } from '@/services';

import { waitFor } from '../test-utils.js';
import { bootstrapMonque, resetMonque } from './helpers/bootstrap.js';
import { Server } from './helpers/Server.js';

// 1. Request Scoped Worker
@WorkerController('request-scoped')
@Scope(ProviderScope.REQUEST)
class RequestScopedController {
	static processed = false;
	static instanceCount = 0;

	constructor() {
		RequestScopedController.instanceCount++;
	}

	@Worker('job')
	async handler(_job: Job) {
		RequestScopedController.processed = true;
	}
}

// 2. Error Throwing Worker
@WorkerController('error')
class ErrorController {
	@Worker('throw')
	async handler(_job: Job) {
		throw new Error('Intentional Failure');
	}
}

// 3. Unresolvable Worker
@WorkerController('unresolvable')
class UnresolvableController {
	@Worker('job')
	async handler(_job: Job) {}
}

describe('MonqueModule Lifecycle Integration', () => {
	afterEach(resetMonque);

	describe('Lifecycle (Mongoose Strategy)', () => {
		beforeEach(() => bootstrapMonque({ connectionStrategy: 'mongoose' }));

		it('should initialize and shutdown gracefully', async () => {
			const monqueService = PlatformTest.get<MonqueService>(MonqueService);
			expect(monqueService).toBeDefined();
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

	describe('Validation & Resolution Edge Cases', () => {
		it('should warn and skip if worker instance cannot be resolved', async () => {
			// Mock injector to fail resolution for UnresolvableController
			const originalGet = InjectorService.prototype.get;
			const getSpy = vi.spyOn(InjectorService.prototype, 'get').mockImplementation(function (
				this: InjectorService,
				token: unknown,
			) {
				if (token === UnresolvableController) {
					return undefined;
				}
				return originalGet.call(this, token as Parameters<InjectorService['get']>[0]);
			});

			try {
				await bootstrapMonque({
					imports: [UnresolvableController],
					connectionStrategy: 'db',
				});

				// If we reached here without error, the module handled the missing instance gracefully.
				const service = PlatformTest.get<MonqueService>(MonqueService);
				expect(service).toBeDefined();
			} finally {
				// Cleanup
				getSpy.mockRestore();
			}
		});

		it('should invoke request scoped workers for each job', async () => {
			RequestScopedController.processed = false;
			RequestScopedController.instanceCount = 0;

			await bootstrapMonque({
				imports: [RequestScopedController],
				connectionStrategy: 'db',
			});

			const service = PlatformTest.get<MonqueService>(MonqueService);

			// Enqueue a job
			await service.enqueue('request-scoped.job', {});

			// Wait for processing (simple poll)
			await waitFor(() => RequestScopedController.processed, {
				timeout: 5000,
			});

			expect(RequestScopedController.processed).toBe(true);
			expect(RequestScopedController.instanceCount).toBeGreaterThan(0);
		});

		it('should catch and log errors from workers', async () => {
			await bootstrapMonque({
				imports: [ErrorController],
				connectionStrategy: 'db',
			});

			const service = PlatformTest.get<MonqueService>(MonqueService);
			const logger = PlatformTest.get(LOGGER);
			const errorSpy = vi.spyOn(logger, 'error');

			await service.enqueue('error.throw', {});

			// Wait for logger to be called
			await waitFor(() => errorSpy.mock.calls.length > 0, { timeout: 5000 });

			expect(errorSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					event: 'MONQUE_JOB_ERROR',
					jobName: 'error.throw',
				}),
			);
		});

		it('should throw on duplicate job registration', async () => {
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

			// We use a fresh bootstrap here because we want to fail during initialization
			// bootstrapMonque helper usually catches errors? No, it awaits bstrp().
			await expect(
				bootstrapMonque({
					imports: [DuplicateController1, DuplicateController2],
					connectionStrategy: 'dbFactory',
				}),
			).rejects.toThrow('Monque: Duplicate job registration detected');
		});
	});
});
