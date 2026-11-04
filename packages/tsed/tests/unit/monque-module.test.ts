import { InvalidCronError, MonqueError, WorkerRegistrationError } from "@monque/core";
/**
 * Unit tests for MonqueModule.registerJobs() edge cases (TEST-01)
 *
 * Tests scope resolution failure, duplicate job detection,
 * partial registration, and malformed metadata handling.
 */
import type { Job, Monque } from "@monque/core";
import { fromPartial } from "@total-typescript/shoehorn";
import { DIContext, ProviderScope } from "@tsed/di";
import type { LOGGER } from "@tsed/di";
import type { Mock } from "vite-plus/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { MonqueModule } from "@/monque-module";
import type * as MonqueUtils from "@/utils";

import { StubControllerA, StubControllerB, StubControllerC } from "./fixtures/stub-controllers";

// ─────────────────────────────────────────────────────────────────────────────
// Mock collectJobMetadata so we can control metadata per-provider
// ─────────────────────────────────────────────────────────────────────────────
const collectJobMetadataMock = vi.fn<typeof MonqueUtils.collectJobMetadata>();

vi.mock(import("@/utils"), async (importOriginal) => {
  const original = await importOriginal<typeof MonqueUtils>();

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
    await this.registerJobs();
  }

  public setMonque(monque: MockMonque): void {
    this.monque = fromPartial<Monque>(monque);
  }

  public setInjector(injector: MockInjector): void {
    this.injector = fromPartial<MonqueModule["injector"]>(injector);
  }

  public setLogger(logger: MockLogger): void {
    this.logger = fromPartial<MonqueModule["logger"]>(logger);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
interface MockLogger {
  info: Mock<LOGGER["info"]>;
  warn: Mock<LOGGER["warn"]>;
  debug: Mock<LOGGER["debug"]>;
  error: Mock<LOGGER["error"]>;
}

interface MockMonque {
  register: Mock<Monque["register"]>;
  schedule: Mock<Monque["schedule"]>;
}

interface MockInjector {
  providers: { getMany: Mock<(type: string) => object[]> };
  get: Mock<(token: symbol | string) => object | undefined>;
}

const createMockLogger = function createMockLogger(): MockLogger {
  return {
    info: vi.fn<LOGGER["info"]>(),
    warn: vi.fn<LOGGER["warn"]>(),
    debug: vi.fn<LOGGER["debug"]>(),
    error: vi.fn<LOGGER["error"]>(),
  };
};

const createMockMonque = function createMockMonque(): MockMonque {
  return {
    register: vi.fn<Monque["register"]>(),
    schedule: vi.fn<Monque["schedule"]>().mockResolvedValue(fromPartial({})),
  };
};

const createMockInjector = function createMockInjector(
  providers: {
    token: symbol | string;
    name: string;
    useClass: new (...args: unknown[]) => object;
    scope?: (typeof ProviderScope)[keyof typeof ProviderScope];
  }[],
  getInstance: (token: symbol | string) => object | undefined,
): MockInjector {
  return {
    providers: { getMany: vi.fn<(type: string) => object[]>().mockReturnValue(providers) },
    get: vi.fn<(token: symbol | string) => object | undefined>().mockImplementation(getInstance),
  };
};

interface HandlerController {
  handle: unknown;
}

const registerHandler = async (
  module: TestableMonqueModule,
  mockMonque: MockMonque,
  instance: HandlerController,
) => {
  const token = Symbol("CtrlA");
  module.setInjector(
    createMockInjector(
      [{ token, name: "CtrlA", useClass: StubControllerA, scope: ProviderScope.SINGLETON }],
      () => instance,
    ),
  );
  collectJobMetadataMock.mockReturnValue([
    { fullName: "ns.job", method: "handle", opts: {}, isCron: false },
  ]);
  await module.callRegisterJobs();
  const handler = mockMonque.register.mock.calls[0]?.[1];

  if (!handler) {
    throw new Error("Expected a registered handler");
  }

  return handler;
};

describe("MonqueModule.registerJobs()", () => {
  let module: TestableMonqueModule;
  let mockLogger: MockLogger;
  let mockMonque: MockMonque;

  beforeEach(() => {
    // Construct bypassing the real DI constructor via Object.create
    module = fromPartial<TestableMonqueModule>({});
    Object.setPrototypeOf(module, TestableMonqueModule.prototype);
    mockLogger = createMockLogger();
    mockMonque = createMockMonque();

    module.setLogger(mockLogger);
    module.setMonque(mockMonque);

    collectJobMetadataMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("handler execution", () => {
    it.each([undefined, "no longer a function"])(
      "fails execution and cleans up the context when a handler becomes %j",
      async (replacement) => {
        const instance = { handle: vi.fn<(job: Job) => void>() };
        const handler = await registerHandler(module, mockMonque, instance);
        Object.defineProperty(instance, "handle", { value: replacement });
        const destroy = vi.spyOn(DIContext.prototype, "destroy");

        await expect(handler(fromPartial<Job>({}))).rejects.toThrow(
          new MonqueError('Monque: Handler "handle" for job "ns.job" is not callable'),
        );
        expect(destroy).toHaveBeenCalledOnce();
      },
    );

    it("awaits a callable handler with its controller receiver and cleans up the context", async () => {
      const received: Job[] = [];

      const instance = {
        jobs: received,

        async handle(job: Job): Promise<void> {
          await Promise.resolve();

          this.jobs.push(job);
        },
      };

      const handler = await registerHandler(module, mockMonque, instance);
      const destroy = vi.spyOn(DIContext.prototype, "destroy");
      const job = fromPartial<Job>({ data: { message: "hello" } });

      await expect(handler(job)).resolves.toBeUndefined();
      expect(received).toStrictEqual([job]);
      expect(destroy).toHaveBeenCalledOnce();
      expect(mockLogger.error).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1. Scope resolution failure
  // ─────────────────────────────────────────────────────────────────────────
  describe("scope resolution failure", () => {
    it("should warn and skip when injector cannot resolve a non-REQUEST scoped controller", async () => {
      const providers = [
        {
          token: Symbol("ControllerA"),
          name: "ControllerA",
          useClass: StubControllerA,
          scope: ProviderScope.SINGLETON,
        },
      ];

      const injector = createMockInjector(providers, () => {});
      module.setInjector(injector);

      collectJobMetadataMock.mockReturnValue([
        {
          fullName: "ns.job-a",
          method: "handle",
          opts: {},
          isCron: false,
        },
      ]);

      // Should NOT throw (or reject)
      await module.callRegisterJobs();

      // logger.warn should have been called with the provider name
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("ControllerA"));

      // monque.register should NOT have been called for the skipped controller
      expect(mockMonque.register).not.toHaveBeenCalled();
    });

    it("should NOT skip a REQUEST-scoped controller even when instance is undefined", async () => {
      const providers = [
        {
          token: Symbol("RequestCtrl"),
          name: "RequestCtrl",
          useClass: StubControllerA,
          scope: ProviderScope.REQUEST,
        },
      ];

      const injector = createMockInjector(providers, () => {});
      module.setInjector(injector);

      collectJobMetadataMock.mockReturnValue([
        {
          fullName: "ns.request-job",
          method: "handle",
          opts: {},
          isCron: false,
        },
      ]);

      await module.callRegisterJobs();

      // Should proceed to register despite undefined instance (REQUEST scope is OK)
      expect(mockLogger.warn).not.toHaveBeenCalled();
      expect(mockMonque.register).toHaveBeenCalledWith("ns.request-job", expect.any(Function), {});
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Duplicate job detection
  // ─────────────────────────────────────────────────────────────────────────
  describe("duplicate job detection", () => {
    it("should throw WorkerRegistrationError when two jobs share the same fullName", async () => {
      const instanceA = new StubControllerA();
      const instanceB = new StubControllerB();

      const tokenA = Symbol("CtrlA");
      const tokenB = Symbol("CtrlB");

      const providers = [
        {
          token: tokenA,
          name: "CtrlA",
          useClass: StubControllerA,
          scope: ProviderScope.SINGLETON,
        },
        {
          token: tokenB,
          name: "CtrlB",
          useClass: StubControllerB,
          scope: ProviderScope.SINGLETON,
        },
      ];

      const instances = new Map<symbol | string, object>([
        [tokenA, instanceA],
        [tokenB, instanceB],
      ]);

      const injector = createMockInjector(providers, (token) => instances.get(token));
      module.setInjector(injector);

      // Both controllers produce a job with the same fullName
      collectJobMetadataMock.mockImplementation((target) => {
        if (target === StubControllerA) {
          return [
            {
              fullName: "ns.duplicate-job",
              method: "handleA",
              opts: {},
              isCron: false,
            },
          ];
        }

        if (target === StubControllerB) {
          return [
            {
              fullName: "ns.duplicate-job",
              method: "handleB",
              opts: {},
              isCron: false,
            },
          ];
        }

        return [];
      });

      const registerJobsPromise = module.callRegisterJobs();
      await expect(registerJobsPromise).rejects.toThrow(WorkerRegistrationError);
      await expect(registerJobsPromise).rejects.toThrow(/duplicate-job/iu);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Partial registration on error
  // ─────────────────────────────────────────────────────────────────────────
  describe("partial registration", () => {
    it("should register jobs before the duplicate but never attempt jobs after", async () => {
      const instanceA = new StubControllerA();
      const instanceB = new StubControllerB();
      const instanceC = new StubControllerC();

      const tokenA = Symbol("CtrlA");
      const tokenB = Symbol("CtrlB");
      const tokenC = Symbol("CtrlC");

      const providers = [
        {
          token: tokenA,
          name: "CtrlA",
          useClass: StubControllerA,
          scope: ProviderScope.SINGLETON,
        },
        {
          token: tokenB,
          name: "CtrlB",
          useClass: StubControllerB,
          scope: ProviderScope.SINGLETON,
        },
        {
          token: tokenC,
          name: "CtrlC",
          useClass: StubControllerC,
          scope: ProviderScope.SINGLETON,
        },
      ];

      const instances = new Map<symbol | string, object>([
        [tokenA, instanceA],
        [tokenB, instanceB],
        [tokenC, instanceC],
      ]);

      const injector = createMockInjector(providers, (token) => instances.get(token));
      module.setInjector(injector);

      collectJobMetadataMock.mockImplementation((target) => {
        if (target === StubControllerA) {
          return [
            {
              fullName: "ns.job-a",
              method: "handleA",
              opts: {},
              isCron: false,
            },
          ];
        }

        if (target === StubControllerB) {
          // This will collide with job-a from CtrlA
          return [
            {
              fullName: "ns.job-a",
              method: "handleB",
              opts: {},
              isCron: false,
            },
          ];
        }

        if (target === StubControllerC) {
          return [
            {
              fullName: "ns.job-c",
              method: "handleC",
              opts: {},
              isCron: false,
            },
          ];
        }

        return [];
      });

      await expect(module.callRegisterJobs()).rejects.toThrow(WorkerRegistrationError);

      // CtrlA's job-a was registered before the error
      expect(mockMonque.register).toHaveBeenCalledExactlyOnceWith(
        "ns.job-a",
        expect.any(Function),
        {},
      );

      // CtrlC's job-c was never attempted (error stopped iteration)
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. Malformed metadata
  // ─────────────────────────────────────────────────────────────────────────
  describe("malformed metadata", () => {
    it("should call register with empty method when method field is empty string", async () => {
      const instance = new StubControllerA();
      const tokenA = Symbol("CtrlA");

      const providers = [
        {
          token: tokenA,
          name: "CtrlA",
          useClass: StubControllerA,
          scope: ProviderScope.SINGLETON,
        },
      ];

      const injector = createMockInjector(providers, () => instance);
      module.setInjector(injector);

      collectJobMetadataMock.mockReturnValue([
        {
          fullName: "ns.empty-method",
          method: "",
          opts: {},
          isCron: false,
        },
      ]);

      // Characterization: current code does NOT guard against empty method.
      // It will call monque.register() with a handler that tries to call instance['']
      await module.callRegisterJobs();

      expect(mockMonque.register).toHaveBeenCalledWith("ns.empty-method", expect.any(Function), {});
    });

    it("should call register with empty fullName when fullName is empty string", async () => {
      const instance = new StubControllerA();
      const tokenA = Symbol("CtrlA");

      const providers = [
        {
          token: tokenA,
          name: "CtrlA",
          useClass: StubControllerA,
          scope: ProviderScope.SINGLETON,
        },
      ];

      const injector = createMockInjector(providers, () => instance);
      module.setInjector(injector);

      collectJobMetadataMock.mockReturnValue([
        {
          fullName: "",
          method: "handle",
          opts: {},
          isCron: false,
        },
      ]);

      // Characterization: current code registers with empty string name
      await module.callRegisterJobs();

      expect(mockMonque.register).toHaveBeenCalledWith("", expect.any(Function), {});
    });

    it("should register but not schedule when isCron is true but cronPattern is undefined", async () => {
      const instance = new StubControllerA();
      const tokenA = Symbol("CtrlA");

      const providers = [
        {
          token: tokenA,
          name: "CtrlA",
          useClass: StubControllerA,
          scope: ProviderScope.SINGLETON,
        },
      ];

      const injector = createMockInjector(providers, () => instance);
      module.setInjector(injector);

      collectJobMetadataMock.mockReturnValue([
        {
          fullName: "ns.broken-cron",
          method: "handle",
          opts: {},
          isCron: true,
          // cronPattern intentionally omitted (undefined)
        },
      ]);

      // Characterization: the code checks `if (isCron && cronPattern)`.
      // Since cronPattern is undefined, it falls to the else branch —
      // registers as a normal job, does NOT call schedule.
      await module.callRegisterJobs();

      expect(mockMonque.register).toHaveBeenCalledWith("ns.broken-cron", expect.any(Function), {});
      expect(mockMonque.schedule).not.toHaveBeenCalled();
    });

    it("forwards an empty @Cron pattern and preserves the scheduling rejection", async () => {
      const instance = new StubControllerA();

      const providers = [
        {
          token: Symbol("CtrlA"),
          name: "CtrlA",
          useClass: StubControllerA,
          scope: ProviderScope.SINGLETON,
        },
      ];

      module.setInjector(createMockInjector(providers, () => instance));
      collectJobMetadataMock.mockReturnValue([
        {
          fullName: "ns.blank-cron",
          method: "handle",
          opts: {},
          isCron: true,
          cronPattern: "",
        },
      ]);
      const failure = new InvalidCronError("", "Cron expression must not be empty");
      mockMonque.schedule.mockRejectedValueOnce(failure);

      await expect(module.callRegisterJobs()).rejects.toBe(failure);
      expect(mockMonque.register).toHaveBeenCalledExactlyOnceWith(
        "ns.blank-cron",
        expect.any(Function),
        {},
      );
      expect(mockMonque.schedule).toHaveBeenCalledExactlyOnceWith("", "ns.blank-cron", {}, {});
    });

    it("should register and schedule when isCron is true with valid cronPattern", async () => {
      const instance = new StubControllerA();
      const tokenA = Symbol("CtrlA");

      const providers = [
        {
          token: tokenA,
          name: "CtrlA",
          useClass: StubControllerA,
          scope: ProviderScope.SINGLETON,
        },
      ];

      const injector = createMockInjector(providers, () => instance);
      module.setInjector(injector);

      collectJobMetadataMock.mockReturnValue([
        {
          fullName: "ns.valid-cron",
          method: "handle",
          opts: {},
          isCron: true,
          cronPattern: "*/5 * * * *",
        },
      ]);

      await module.callRegisterJobs();

      expect(mockMonque.register).toHaveBeenCalledWith("ns.valid-cron", expect.any(Function), {});
      expect(mockMonque.schedule).toHaveBeenCalledWith("*/5 * * * *", "ns.valid-cron", {}, {});
    });
  });
});
