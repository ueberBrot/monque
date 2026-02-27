/**
 * Unit tests for MonqueModule.registerJobs() edge cases (TEST-01)
 *
 * Tests scope resolution failure, duplicate job detection,
 * partial registration, and malformed metadata handling.
 */

import type { Monque } from '@monque/core';
import { WorkerRegistrationError } from '@monque/core';
import { ProviderScope } from '@tsed/di';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MonqueModule } from '@/monque-module';
import type { CollectedJobMetadata } from '@/utils';

// ─────────────────────────────────────────────────────────────────────────────
// Mock collectJobMetadata so we can control metadata per-provider
// ─────────────────────────────────────────────────────────────────────────────
const collectJobMetadataMock =
	vi.fn<(target: new (...args: unknown[]) => unknown) => CollectedJobMetadata[]>();

vi.mock('@/utils', async (importOriginal) => {
	const original = await importOriginal<typeof import('@/utils')>();
	return {
		...original,
		collectJobMetadata: (...args: Parameters<typeof collectJobMetadataMock>) =>
			collectJobMetadataMock(...args),
	};
});

// ─────────────────────────────────────────────────────────────────────────────
// Testable subclass that exposes protected registerJobs()
// ─────────────────────────────────────────────────────────────────────────────
class TestableMonqueModule extends MonqueModule {
	public async callRegisterJobs(): Promise<void> {
		return this.registerJobs();
	}

	public setMonque(monque: unknown): void {
		this.monque = monque as Monque;
	}

	public setInjector(injector: unknown): void {
		this.injector = injector as MonqueModule['injector'];
	}

	public setLogger(logger: unknown): void {
		this.logger = logger as MonqueModule['logger'];
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
interface MockLogger {
	info: ReturnType<typeof vi.fn>;
	warn: ReturnType<typeof vi.fn>;
	debug: ReturnType<typeof vi.fn>;
	error: ReturnType<typeof vi.fn>;
}

interface MockMonque {
	register: ReturnType<typeof vi.fn>;
	schedule: ReturnType<typeof vi.fn>;
}

interface MockInjector {
	getProviders: ReturnType<typeof vi.fn>;
	get: ReturnType<typeof vi.fn>;
}

function createMockLogger(): MockLogger {
	return {
		info: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
	};
}

function createMockMonque(): MockMonque {
	return {
		register: vi.fn(),
		schedule: vi.fn().mockResolvedValue(undefined),
	};
}

function createMockInjector(
	providers: Array<{
		token: symbol | string;
		name: string;
		useClass: new (...args: unknown[]) => unknown;
		scope?: (typeof ProviderScope)[keyof typeof ProviderScope];
	}>,
	getInstance: (token: symbol | string) => unknown,
): MockInjector {
	return {
		getProviders: vi.fn().mockReturnValue(providers),
		get: vi.fn().mockImplementation(getInstance),
	};
}

/** Stub class to use as useClass for providers */
class StubControllerA {}
class StubControllerB {}
class StubControllerC {}

describe('MonqueModule.registerJobs()', () => {
	let module: TestableMonqueModule;
	let mockLogger: MockLogger;
	let mockMonque: MockMonque;

	beforeEach(() => {
		// Construct bypassing the real DI constructor via Object.create
		module = Object.create(TestableMonqueModule.prototype) as TestableMonqueModule;
		mockLogger = createMockLogger();
		mockMonque = createMockMonque();

		module.setLogger(mockLogger);
		module.setMonque(mockMonque);

		collectJobMetadataMock.mockReset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// ─────────────────────────────────────────────────────────────────────────
	// 1. Scope resolution failure
	// ─────────────────────────────────────────────────────────────────────────
	describe('scope resolution failure', () => {
		it('should warn and skip when injector cannot resolve a non-REQUEST scoped controller', () => {
			const providers = [
				{
					token: Symbol('ControllerA'),
					name: 'ControllerA',
					useClass: StubControllerA,
					scope: ProviderScope.SINGLETON,
				},
			];

			const injector = createMockInjector(providers, () => undefined);
			module.setInjector(injector);

			collectJobMetadataMock.mockReturnValue([
				{
					fullName: 'ns.job-a',
					method: 'handle',
					opts: {},
					isCron: false,
				},
			]);

			// Should NOT throw
			expect(() => module.callRegisterJobs()).not.toThrow();

			// logger.warn should have been called with the provider name
			expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('ControllerA'));

			// monque.register should NOT have been called for the skipped controller
			expect(mockMonque.register).not.toHaveBeenCalled();
		});

		it('should NOT skip a REQUEST-scoped controller even when instance is undefined', async () => {
			const providers = [
				{
					token: Symbol('RequestCtrl'),
					name: 'RequestCtrl',
					useClass: StubControllerA,
					scope: ProviderScope.REQUEST,
				},
			];

			const injector = createMockInjector(providers, () => undefined);
			module.setInjector(injector);

			collectJobMetadataMock.mockReturnValue([
				{
					fullName: 'ns.request-job',
					method: 'handle',
					opts: {},
					isCron: false,
				},
			]);

			await module.callRegisterJobs();

			// Should proceed to register despite undefined instance (REQUEST scope is OK)
			expect(mockLogger.warn).not.toHaveBeenCalled();
			expect(mockMonque.register).toHaveBeenCalledWith('ns.request-job', expect.any(Function), {});
		});
	});

	// ─────────────────────────────────────────────────────────────────────────
	// 2. Duplicate job detection
	// ─────────────────────────────────────────────────────────────────────────
	describe('duplicate job detection', () => {
		it('should throw WorkerRegistrationError when two jobs share the same fullName', async () => {
			const instanceA = new StubControllerA();
			const instanceB = new StubControllerB();

			const tokenA = Symbol('CtrlA');
			const tokenB = Symbol('CtrlB');

			const providers = [
				{
					token: tokenA,
					name: 'CtrlA',
					useClass: StubControllerA,
					scope: ProviderScope.SINGLETON,
				},
				{
					token: tokenB,
					name: 'CtrlB',
					useClass: StubControllerB,
					scope: ProviderScope.SINGLETON,
				},
			];

			const injector = createMockInjector(providers, (token) => {
				if (token === tokenA) return instanceA;
				if (token === tokenB) return instanceB;
				return undefined;
			});
			module.setInjector(injector);

			// Both controllers produce a job with the same fullName
			collectJobMetadataMock.mockImplementation((target) => {
				if (target === StubControllerA) {
					return [
						{
							fullName: 'ns.duplicate-job',
							method: 'handleA',
							opts: {},
							isCron: false,
						},
					];
				}
				if (target === StubControllerB) {
					return [
						{
							fullName: 'ns.duplicate-job',
							method: 'handleB',
							opts: {},
							isCron: false,
						},
					];
				}
				return [];
			});

			await expect(module.callRegisterJobs()).rejects.toThrow(WorkerRegistrationError);
			await expect(module.callRegisterJobs()).rejects.toThrow(/duplicate-job/i);
		});
	});

	// ─────────────────────────────────────────────────────────────────────────
	// 3. Partial registration on error
	// ─────────────────────────────────────────────────────────────────────────
	describe('partial registration', () => {
		it('should register jobs before the duplicate but never attempt jobs after', async () => {
			const instanceA = new StubControllerA();
			const instanceB = new StubControllerB();
			const instanceC = new StubControllerC();

			const tokenA = Symbol('CtrlA');
			const tokenB = Symbol('CtrlB');
			const tokenC = Symbol('CtrlC');

			const providers = [
				{
					token: tokenA,
					name: 'CtrlA',
					useClass: StubControllerA,
					scope: ProviderScope.SINGLETON,
				},
				{
					token: tokenB,
					name: 'CtrlB',
					useClass: StubControllerB,
					scope: ProviderScope.SINGLETON,
				},
				{
					token: tokenC,
					name: 'CtrlC',
					useClass: StubControllerC,
					scope: ProviderScope.SINGLETON,
				},
			];

			const injector = createMockInjector(providers, (token) => {
				if (token === tokenA) return instanceA;
				if (token === tokenB) return instanceB;
				if (token === tokenC) return instanceC;
				return undefined;
			});
			module.setInjector(injector);

			collectJobMetadataMock.mockImplementation((target) => {
				if (target === StubControllerA) {
					return [
						{
							fullName: 'ns.job-a',
							method: 'handleA',
							opts: {},
							isCron: false,
						},
					];
				}
				if (target === StubControllerB) {
					// This will collide with job-a from CtrlA
					return [
						{
							fullName: 'ns.job-a',
							method: 'handleB',
							opts: {},
							isCron: false,
						},
					];
				}
				if (target === StubControllerC) {
					return [
						{
							fullName: 'ns.job-c',
							method: 'handleC',
							opts: {},
							isCron: false,
						},
					];
				}
				return [];
			});

			await expect(module.callRegisterJobs()).rejects.toThrow(WorkerRegistrationError);

			// CtrlA's job-a was registered before the error
			expect(mockMonque.register).toHaveBeenCalledTimes(1);
			expect(mockMonque.register).toHaveBeenCalledWith('ns.job-a', expect.any(Function), {});

			// CtrlC's job-c was never attempted (error stopped iteration)
		});
	});

	// ─────────────────────────────────────────────────────────────────────────
	// 4. Malformed metadata
	// ─────────────────────────────────────────────────────────────────────────
	describe('malformed metadata', () => {
		it('should call register with empty method when method field is empty string', async () => {
			const instance = new StubControllerA();
			const tokenA = Symbol('CtrlA');

			const providers = [
				{
					token: tokenA,
					name: 'CtrlA',
					useClass: StubControllerA,
					scope: ProviderScope.SINGLETON,
				},
			];

			const injector = createMockInjector(providers, () => instance);
			module.setInjector(injector);

			collectJobMetadataMock.mockReturnValue([
				{
					fullName: 'ns.empty-method',
					method: '',
					opts: {},
					isCron: false,
				},
			]);

			// Characterization: current code does NOT guard against empty method.
			// It will call monque.register() with a handler that tries to call instance['']
			await module.callRegisterJobs();

			expect(mockMonque.register).toHaveBeenCalledWith('ns.empty-method', expect.any(Function), {});
		});

		it('should call register with empty fullName when fullName is empty string', async () => {
			const instance = new StubControllerA();
			const tokenA = Symbol('CtrlA');

			const providers = [
				{
					token: tokenA,
					name: 'CtrlA',
					useClass: StubControllerA,
					scope: ProviderScope.SINGLETON,
				},
			];

			const injector = createMockInjector(providers, () => instance);
			module.setInjector(injector);

			collectJobMetadataMock.mockReturnValue([
				{
					fullName: '',
					method: 'handle',
					opts: {},
					isCron: false,
				},
			]);

			// Characterization: current code registers with empty string name
			await module.callRegisterJobs();

			expect(mockMonque.register).toHaveBeenCalledWith('', expect.any(Function), {});
		});

		it('should register but not schedule when isCron is true but cronPattern is undefined', async () => {
			const instance = new StubControllerA();
			const tokenA = Symbol('CtrlA');

			const providers = [
				{
					token: tokenA,
					name: 'CtrlA',
					useClass: StubControllerA,
					scope: ProviderScope.SINGLETON,
				},
			];

			const injector = createMockInjector(providers, () => instance);
			module.setInjector(injector);

			collectJobMetadataMock.mockReturnValue([
				{
					fullName: 'ns.broken-cron',
					method: 'handle',
					opts: {},
					isCron: true,
					// cronPattern intentionally omitted (undefined)
				},
			]);

			// Characterization: the code checks `if (isCron && cronPattern)`.
			// Since cronPattern is undefined, it falls to the else branch —
			// registers as a normal job, does NOT call schedule.
			await module.callRegisterJobs();

			expect(mockMonque.register).toHaveBeenCalledWith('ns.broken-cron', expect.any(Function), {});
			expect(mockMonque.schedule).not.toHaveBeenCalled();
		});

		it('should register and schedule when isCron is true with valid cronPattern', async () => {
			const instance = new StubControllerA();
			const tokenA = Symbol('CtrlA');

			const providers = [
				{
					token: tokenA,
					name: 'CtrlA',
					useClass: StubControllerA,
					scope: ProviderScope.SINGLETON,
				},
			];

			const injector = createMockInjector(providers, () => instance);
			module.setInjector(injector);

			collectJobMetadataMock.mockReturnValue([
				{
					fullName: 'ns.valid-cron',
					method: 'handle',
					opts: {},
					isCron: true,
					cronPattern: '*/5 * * * *',
				},
			]);

			await module.callRegisterJobs();

			expect(mockMonque.register).toHaveBeenCalledWith('ns.valid-cron', expect.any(Function), {});
			expect(mockMonque.schedule).toHaveBeenCalledWith('*/5 * * * *', 'ns.valid-cron', {}, {});
		});
	});
});
