import type { Monque } from '@monque/core';
import { Store } from '@tsed/core';
import { constant, inject, injector, logger, type Provider } from '@tsed/di';
import { $asyncEmit } from '@tsed/hooks';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { JobFactory, JobFactoryHelpers } from '@tests/test-utils/factories/job.factory.js';
import { runInJobContext } from '@/dispatch/index.js';
import type { ControllerStore } from '@/jobs/index.js';
import { afterListen, getOpts, onDestroy, registerController } from '@/services/helpers.js';
import type { MonqueSettings } from '@/services/types.js';
import { MONQUE_METADATA, MonqueTypes } from '@/shared/index.js';

// Mock dependencies
vi.mock('@tsed/di', () => ({
	constant: vi.fn(),
	inject: vi.fn(),
	injector: vi.fn(),
	logger: vi.fn(() => ({
		info: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
		trace: vi.fn(),
	})),
}));

vi.mock('@tsed/hooks', () => ({
	$asyncEmit: vi.fn(),
}));

vi.mock('@/dispatch/index.js', () => ({
	runInJobContext: vi.fn((_job, handler) => handler()),
}));

describe('Helper Functions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('getOpts()', () => {
		it('should return monque configuration from DI container', () => {
			const mockConfig: MonqueSettings = {
				enabled: true,
				url: 'mongodb://localhost:27017/test',
				pollInterval: 1000,
			};

			vi.mocked(constant).mockReturnValue(mockConfig);

			const result = getOpts();

			expect(constant).toHaveBeenCalledWith('monque', { enabled: false });
			expect(result).toEqual(mockConfig);
		});

		it('should return default config when monque not configured', () => {
			const defaultConfig: MonqueSettings = { enabled: false };

			vi.mocked(constant).mockReturnValue(defaultConfig);

			const result = getOpts();

			expect(result).toEqual(defaultConfig);
			expect(result.enabled).toBe(false);
		});

		it('should handle partial configuration', () => {
			const partialConfig: MonqueSettings = {
				enabled: true,
				pollInterval: 500,
			};

			vi.mocked(constant).mockReturnValue(partialConfig);

			const result = getOpts();

			expect(result.enabled).toBe(true);
			expect(result.pollInterval).toBe(500);
		});
	});

	describe('registerController()', () => {
		it('should return early when controller has no MONQUE_METADATA', async () => {
			const mockMonque = {
				worker: vi.fn(),
				schedule: vi.fn(),
			} as unknown as Monque;

			class TestController {}

			const provider = {
				provide: TestController,
				useClass: TestController,
				type: MonqueTypes.CONTROLLER,
			} as Provider;

			await registerController(mockMonque, provider);

			expect(mockMonque.worker).not.toHaveBeenCalled();
			expect(mockMonque.schedule).not.toHaveBeenCalled();
		});

		it('should register @Job methods without namespace', async () => {
			const mockMonque = {
				worker: vi.fn(),
			} as unknown as Monque;

			class TestController {
				async processData() {}
			}

			const controllerMeta: ControllerStore = {
				jobs: {
					processData: {
						name: 'process-data',
						options: {},
					},
				},
			};

			Store.from(TestController).set(MONQUE_METADATA, controllerMeta);

			const provider = {
				provide: TestController,
				useClass: TestController,
				type: MonqueTypes.CONTROLLER,
			} as Provider;

			const mockInstance = new TestController();
			vi.mocked(inject).mockReturnValue(mockInstance);

			await registerController(mockMonque, provider);

			expect(mockMonque.worker).toHaveBeenCalledWith(
				'process-data',
				expect.any(Function),
				undefined,
			);
		});

		it('should register @Job methods with namespace', async () => {
			const mockMonque = {
				worker: vi.fn(),
			} as unknown as Monque;

			class TestController {
				async sendEmail() {}
			}

			const controllerMeta: ControllerStore = {
				jobs: {
					sendEmail: {
						name: 'send-welcome',
						options: {},
					},
				},
			};

			Store.from(TestController)
				.set(MONQUE_METADATA, controllerMeta)
				.set('monque', { namespace: 'email' });

			const provider = {
				provide: TestController,
				useClass: TestController,
				type: MonqueTypes.CONTROLLER,
			} as Provider;

			const mockInstance = new TestController();
			vi.mocked(inject).mockReturnValue(mockInstance);

			await registerController(mockMonque, provider);

			expect(mockMonque.worker).toHaveBeenCalledWith(
				'email.send-welcome',
				expect.any(Function),
				undefined,
			);
		});

		it('should register @Job methods with concurrency option', async () => {
			const mockMonque = {
				worker: vi.fn(),
			} as unknown as Monque;

			class TestController {
				async processJob() {}
			}

			const controllerMeta: ControllerStore = {
				jobs: {
					processJob: {
						name: 'process-job',
						options: { concurrency: 5 },
					},
				},
			};

			Store.from(TestController).set(MONQUE_METADATA, controllerMeta);

			const provider = {
				provide: TestController,
				useClass: TestController,
				type: MonqueTypes.CONTROLLER,
			} as Provider;

			const mockInstance = new TestController();
			vi.mocked(inject).mockReturnValue(mockInstance);

			await registerController(mockMonque, provider);

			expect(mockMonque.worker).toHaveBeenCalledWith('process-job', expect.any(Function), {
				concurrency: 5,
			});
		});

		it('should register @Cron methods with auto-generated name', async () => {
			const mockMonque = {
				worker: vi.fn(),
				schedule: vi.fn(),
			} as unknown as Monque;

			class TestController {
				async dailyCron() {}
			}

			const controllerMeta: ControllerStore = {
				cron: {
					dailyCron: {
						expression: '0 0 * * *',
						options: {},
					},
				},
			};

			Store.from(TestController).set(MONQUE_METADATA, controllerMeta);

			const provider = {
				provide: TestController,
				useClass: TestController,
				type: MonqueTypes.CONTROLLER,
			} as Provider;

			const mockInstance = new TestController();
			vi.mocked(inject).mockReturnValue(mockInstance);

			await registerController(mockMonque, provider);

			expect(mockMonque.worker).toHaveBeenCalledWith(
				'TestController.dailyCron',
				expect.any(Function),
				undefined,
			);
			expect(mockMonque.schedule).toHaveBeenCalledWith(
				'0 0 * * *',
				'TestController.dailyCron',
				{},
				{ uniqueKey: 'cron:TestController.dailyCron' },
			);
		});

		it('should register @Cron methods with custom name', async () => {
			const mockMonque = {
				worker: vi.fn(),
				schedule: vi.fn(),
			} as unknown as Monque;

			class TestController {
				async dailyCron() {}
			}

			const controllerMeta: ControllerStore = {
				cron: {
					dailyCron: {
						name: 'daily-summary',
						expression: '0 0 * * *',
						options: {},
					},
				},
			};

			Store.from(TestController).set(MONQUE_METADATA, controllerMeta);

			const provider = {
				provide: TestController,
				useClass: TestController,
				type: MonqueTypes.CONTROLLER,
			} as Provider;

			const mockInstance = new TestController();
			vi.mocked(inject).mockReturnValue(mockInstance);

			await registerController(mockMonque, provider);

			expect(mockMonque.worker).toHaveBeenCalledWith(
				'daily-summary',
				expect.any(Function),
				undefined,
			);
			expect(mockMonque.schedule).toHaveBeenCalledWith(
				'0 0 * * *',
				'daily-summary',
				{},
				{ uniqueKey: 'cron:TestController.dailyCron' },
			);
		});

		it('should register @Cron methods with namespace', async () => {
			const mockMonque = {
				worker: vi.fn(),
				schedule: vi.fn(),
			} as unknown as Monque;

			class TestController {
				async hourlyCron() {}
			}

			const controllerMeta: ControllerStore = {
				cron: {
					hourlyCron: {
						name: 'hourly-task',
						expression: '0 * * * *',
						options: {},
					},
				},
			};

			Store.from(TestController)
				.set(MONQUE_METADATA, controllerMeta)
				.set('monque', { namespace: 'tasks' });

			const provider = {
				provide: TestController,
				useClass: TestController,
				type: MonqueTypes.CONTROLLER,
			} as Provider;

			const mockInstance = new TestController();
			vi.mocked(inject).mockReturnValue(mockInstance);

			await registerController(mockMonque, provider);

			expect(mockMonque.worker).toHaveBeenCalledWith(
				'tasks.hourly-task',
				expect.any(Function),
				undefined,
			);
			expect(mockMonque.schedule).toHaveBeenCalledWith(
				'0 * * * *',
				'tasks.hourly-task',
				{},
				{ uniqueKey: 'cron:TestController.hourlyCron' },
			);
		});

		it('should register @Cron methods with custom uniqueKey', async () => {
			const mockMonque = {
				worker: vi.fn(),
				schedule: vi.fn(),
			} as unknown as Monque;

			class TestController {
				async customCron() {}
			}

			const controllerMeta: ControllerStore = {
				cron: {
					customCron: {
						expression: '*/5 * * * *',
						options: { uniqueKey: 'my-custom-key' },
					},
				},
			};

			Store.from(TestController).set(MONQUE_METADATA, controllerMeta);

			const provider = {
				provide: TestController,
				useClass: TestController,
				type: MonqueTypes.CONTROLLER,
			} as Provider;

			const mockInstance = new TestController();
			vi.mocked(inject).mockReturnValue(mockInstance);

			await registerController(mockMonque, provider);

			expect(mockMonque.schedule).toHaveBeenCalledWith(
				'*/5 * * * *',
				'TestController.customCron',
				{},
				{ uniqueKey: 'my-custom-key' },
			);
		});

		it('should register @Cron methods with concurrency option', async () => {
			const mockMonque = {
				worker: vi.fn(),
				schedule: vi.fn(),
			} as unknown as Monque;

			class TestController {
				async concurrentCron() {}
			}

			const controllerMeta: ControllerStore = {
				cron: {
					concurrentCron: {
						expression: '0 * * * *',
						options: { concurrency: 3 },
					},
				},
			};

			Store.from(TestController).set(MONQUE_METADATA, controllerMeta);

			const provider = {
				provide: TestController,
				useClass: TestController,
				type: MonqueTypes.CONTROLLER,
			} as Provider;

			const mockInstance = new TestController();
			vi.mocked(inject).mockReturnValue(mockInstance);

			await registerController(mockMonque, provider);

			expect(mockMonque.worker).toHaveBeenCalledWith(
				'TestController.concurrentCron',
				expect.any(Function),
				{ concurrency: 3 },
			);
		});

		it('should wrap handlers with runInJobContext', async () => {
			const mockMonque = {
				worker: vi.fn(),
			} as unknown as Monque;

			class TestController {
				async testJob() {}
			}

			const controllerMeta: ControllerStore = {
				jobs: {
					testJob: {
						name: 'test-job',
						options: {},
					},
				},
			};

			Store.from(TestController).set(MONQUE_METADATA, controllerMeta);

			const provider = {
				provide: TestController,
				useClass: TestController,
				type: MonqueTypes.CONTROLLER,
			} as Provider;

			const mockInstance = new TestController();
			vi.mocked(inject).mockReturnValue(mockInstance);

			await registerController(mockMonque, provider);

			// Get the registered handler
			const registeredHandler = vi.mocked(mockMonque.worker).mock.calls[0]?.[1];
			expect(registeredHandler).toBeDefined();

			// Call the handler
			const mockJob = JobFactory.build();
			await registeredHandler?.(mockJob);

			expect(runInJobContext).toHaveBeenCalledWith(mockJob, expect.any(Function));
		});

		it('should call controller method when handler is invoked', async () => {
			const mockMonque = {
				worker: vi.fn(),
			} as unknown as Monque;

			const mockMethod = vi.fn();

			class TestController {
				testJob = mockMethod;
			}

			const controllerMeta: ControllerStore = {
				jobs: {
					testJob: {
						name: 'test-job',
						options: {},
					},
				},
			};

			Store.from(TestController).set(MONQUE_METADATA, controllerMeta);

			const provider = {
				provide: TestController,
				useClass: TestController,
				type: MonqueTypes.CONTROLLER,
			} as Provider;

			const mockInstance = new TestController();
			vi.mocked(inject).mockReturnValue(mockInstance);

			await registerController(mockMonque, provider);

			// Get and invoke the registered handler
			const registeredHandler = vi.mocked(mockMonque.worker).mock.calls[0]?.[1];
			const mockJob = JobFactoryHelpers.withData({ test: 'data' });
			await registeredHandler?.(mockJob);

			expect(mockMethod).toHaveBeenCalledWith(mockJob.data, mockJob);
		});

		it('should throw error when method is not a function', async () => {
			const mockMonque = {
				worker: vi.fn(),
			} as unknown as Monque;

			class TestController {
				testJob = 'not-a-function';
			}

			const controllerMeta: ControllerStore = {
				jobs: {
					testJob: {
						name: 'test-job',
						options: {},
					},
				},
			};

			Store.from(TestController).set(MONQUE_METADATA, controllerMeta);

			const provider = {
				provide: TestController,
				useClass: TestController,
				type: MonqueTypes.CONTROLLER,
			} as Provider;

			const mockInstance = new TestController();
			vi.mocked(inject).mockReturnValue(mockInstance);

			await registerController(mockMonque, provider);

			// Get and invoke the registered handler
			const registeredHandler = vi.mocked(mockMonque.worker).mock.calls[0]?.[1];
			const mockJob = JobFactory.build();

			await expect(registeredHandler?.(mockJob)).rejects.toThrow(
				'Method "testJob" not found on TestController',
			);
		});

		it('should register both @Job and @Cron methods from same controller', async () => {
			const mockMonque = {
				worker: vi.fn(),
				schedule: vi.fn(),
			} as unknown as Monque;

			class TestController {
				async processJob() {}
				async dailyCron() {}
			}

			const controllerMeta: ControllerStore = {
				jobs: {
					processJob: {
						name: 'process-job',
						options: {},
					},
				},
				cron: {
					dailyCron: {
						expression: '0 0 * * *',
						options: {},
					},
				},
			};

			Store.from(TestController).set(MONQUE_METADATA, controllerMeta);

			const provider = {
				provide: TestController,
				useClass: TestController,
				type: MonqueTypes.CONTROLLER,
			} as Provider;

			const mockInstance = new TestController();
			vi.mocked(inject).mockReturnValue(mockInstance);

			await registerController(mockMonque, provider);

			expect(mockMonque.worker).toHaveBeenCalledTimes(2);
			expect(mockMonque.schedule).toHaveBeenCalledTimes(1);
		});
	});

	describe('afterListen()', () => {
		it('should return early when monque is disabled', async () => {
			vi.mocked(constant).mockReturnValue({ enabled: false });

			const mockMonque = {
				initialize: vi.fn(),
				start: vi.fn(),
			} as unknown as Monque;

			await afterListen(mockMonque);

			expect(mockMonque.initialize).not.toHaveBeenCalled();
			expect(mockMonque.start).not.toHaveBeenCalled();
			expect(logger).not.toHaveBeenCalled();
		});

		it('should initialize monque when enabled', async () => {
			const mockLogger = {
				info: vi.fn(),
				warn: vi.fn(),
				debug: vi.fn(),
				error: vi.fn(),
				trace: vi.fn(),
			};
			vi.mocked(constant).mockReturnValue({ enabled: true });
			vi.mocked(logger).mockReturnValue(mockLogger);
			vi.mocked(injector).mockReturnValue({
				getProviders: vi.fn().mockReturnValue([]),
			} as any);

			const mockMonque = {
				initialize: vi.fn(),
				start: vi.fn(),
			} as unknown as Monque;

			await afterListen(mockMonque);

			expect(mockMonque.initialize).toHaveBeenCalledOnce();
			expect(mockMonque.start).toHaveBeenCalledOnce();
			expect(mockLogger.info).toHaveBeenCalledWith({
				event: 'MONQUE_INIT',
				message: 'Initializing Monque scheduler',
			});
		});

		it('should emit lifecycle hooks', async () => {
			const mockLogger = {
				info: vi.fn(),
				warn: vi.fn(),
				debug: vi.fn(),
				error: vi.fn(),
				trace: vi.fn(),
			};
			vi.mocked(constant).mockReturnValue({ enabled: true });
			vi.mocked(logger).mockReturnValue(mockLogger);
			vi.mocked(injector).mockReturnValue({
				getProviders: vi.fn().mockReturnValue([]),
			} as any);

			const mockMonque = {
				initialize: vi.fn(),
				start: vi.fn(),
			} as unknown as Monque;

			await afterListen(mockMonque);

			expect($asyncEmit).toHaveBeenCalledWith('$beforeMonqueStart');
			expect($asyncEmit).toHaveBeenCalledWith('$afterMonqueStart');
		});

		it('should discover and register controllers', async () => {
			const mockLogger = {
				info: vi.fn(),
				warn: vi.fn(),
				debug: vi.fn(),
				error: vi.fn(),
				trace: vi.fn(),
			};
			vi.mocked(constant).mockReturnValue({ enabled: true });
			vi.mocked(logger).mockReturnValue(mockLogger);

			class TestController {
				async testJob() {}
			}

			const controllerMeta: ControllerStore = {
				jobs: {
					testJob: {
						name: 'test-job',
						options: {},
					},
				},
			};

			Store.from(TestController).set(MONQUE_METADATA, controllerMeta);

			const provider = {
				provide: TestController,
				useClass: TestController,
				type: MonqueTypes.CONTROLLER,
			} as Provider;

			vi.mocked(injector).mockReturnValue({
				getProviders: vi.fn().mockReturnValue([provider]),
			} as any);

			const mockInstance = new TestController();
			vi.mocked(inject).mockReturnValue(mockInstance);

			const mockMonque = {
				initialize: vi.fn(),
				start: vi.fn(),
				worker: vi.fn(),
			} as unknown as Monque;

			await afterListen(mockMonque);

			expect(mockLogger.info).toHaveBeenCalledWith({
				event: 'MONQUE_REGISTER_CONTROLLERS',
				message: 'Registering 1 job controllers',
			});
			expect(mockMonque.worker).toHaveBeenCalledWith('test-job', expect.any(Function), undefined);
		});

		it('should log all lifecycle events', async () => {
			const mockLogger = {
				info: vi.fn(),
				warn: vi.fn(),
				debug: vi.fn(),
				error: vi.fn(),
				trace: vi.fn(),
			};
			vi.mocked(constant).mockReturnValue({ enabled: true });
			vi.mocked(logger).mockReturnValue(mockLogger);
			vi.mocked(injector).mockReturnValue({
				getProviders: vi.fn().mockReturnValue([]),
			} as any);

			const mockMonque = {
				initialize: vi.fn(),
				start: vi.fn(),
			} as unknown as Monque;

			await afterListen(mockMonque);

			expect(mockLogger.info).toHaveBeenCalledWith({
				event: 'MONQUE_INIT',
				message: 'Initializing Monque scheduler',
			});
			expect(mockLogger.info).toHaveBeenCalledWith({
				event: 'MONQUE_REGISTER_CONTROLLERS',
				message: 'Registering 0 job controllers',
			});
			expect(mockLogger.info).toHaveBeenCalledWith({
				event: 'MONQUE_STARTED',
				message: 'Monque scheduler started',
			});
		});
	});

	describe('onDestroy()', () => {
		it('should return early when monque is disabled', async () => {
			vi.mocked(constant).mockReturnValue({ enabled: false });

			const mockMonque = {
				stop: vi.fn(),
			} as unknown as Monque;

			await onDestroy(mockMonque);

			expect(mockMonque.stop).not.toHaveBeenCalled();
			expect(logger).not.toHaveBeenCalled();
		});

		it('should stop monque gracefully when enabled', async () => {
			const mockLogger = {
				info: vi.fn(),
				warn: vi.fn(),
				debug: vi.fn(),
				error: vi.fn(),
				trace: vi.fn(),
			};
			vi.mocked(constant).mockReturnValue({ enabled: true });
			vi.mocked(logger).mockReturnValue(mockLogger);

			const mockMonque = {
				stop: vi.fn(),
			} as unknown as Monque;

			await onDestroy(mockMonque);

			expect(mockMonque.stop).toHaveBeenCalledOnce();
			expect(mockLogger.info).toHaveBeenCalledWith({
				event: 'MONQUE_SHUTDOWN',
				message: 'Gracefully shutting down Monque',
			});
			expect(mockLogger.info).toHaveBeenCalledWith({
				event: 'MONQUE_STOPPED',
				message: 'Monque stopped',
			});
		});

		it('should log shutdown lifecycle events', async () => {
			const mockLogger = {
				info: vi.fn(),
				warn: vi.fn(),
				debug: vi.fn(),
				error: vi.fn(),
				trace: vi.fn(),
			};
			vi.mocked(constant).mockReturnValue({ enabled: true });
			vi.mocked(logger).mockReturnValue(mockLogger);

			const mockMonque = {
				stop: vi.fn(),
			} as unknown as Monque;

			await onDestroy(mockMonque);

			expect(mockLogger.info).toHaveBeenCalledTimes(2);
		});
	});
});
