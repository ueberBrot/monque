/* oxlint-disable eslint/max-classes-per-file -- Each scenario needs a fresh decorated constructor to isolate TsED metadata. */
import type { Job as MonqueJob, Monque } from "@monque/core";
import { fromPartial } from "@total-typescript/shoehorn";
import { DIContext, ProviderScope } from "@tsed/di";
import type { Configuration, InjectorService, LOGGER } from "@tsed/di";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { Cron, Job, JobController } from "@/decorators";
import { MonqueModule } from "@/monque-module";
import { MonqueService } from "@/services";

class TestableMonqueModule extends MonqueModule {
  setMonque(monque: Monque): void {
    this.monque = monque;
  }

  async registerDecoratedJobs(): Promise<void> {
    await this.registerJobs();
  }
}

const createModule = function createModule<TController extends object>(
  controllerType: new () => TController,
  instance: TController,
) {
  const register = vi.fn<Monque["register"]>();
  const schedule = vi.fn<Monque["schedule"]>().mockResolvedValue(fromPartial({}));

  const module = new TestableMonqueModule(
    fromPartial<InjectorService>({
      providers: {
        getMany: () => [
          {
            token: controllerType,
            name: controllerType.name,
            useClass: controllerType,
            scope: ProviderScope.SINGLETON,
          },
        ],
      },
      get: vi.fn<InjectorService["get"]>().mockReturnValue(instance),
    }),
    new MonqueService(),
    fromPartial<LOGGER>({
      info: vi.fn<LOGGER["info"]>(),
      debug: vi.fn<LOGGER["debug"]>(),
      error: vi.fn<LOGGER["error"]>(),
    }),
    fromPartial<Configuration>({ get: vi.fn<Configuration["get"]>().mockReturnValue({}) }),
  );

  module.setMonque(fromPartial<Monque>({ register, schedule }));

  const execute = async function execute(job: MonqueJob): Promise<void> {
    const handler = register.mock.calls[0]?.[1];

    if (!handler) {
      throw new Error("Expected a registered handler");
    }

    await handler(job);
  };

  return { module, register, schedule, execute };
};

describe("decorated job execution", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(["job", "cron"] as const)("executes a symbol-named %s method", async (kind) => {
    const method = Symbol("run");
    const decorate = kind === "job" ? Job("run") : Cron("@daily");
    const received: MonqueJob[] = [];

    @JobController("symbols")
    class SymbolJobs {
      readonly jobs = received;

      @decorate
      [method](job: MonqueJob): void {
        this.jobs.push(job);
      }
    }

    const { module, register, schedule, execute } = createModule(SymbolJobs, new SymbolJobs());
    const destroy = vi.spyOn(DIContext.prototype, "destroy");
    await module.registerDecoratedJobs();
    const job = fromPartial<MonqueJob>({ data: { message: "hello" } });
    await execute(job);

    expect(received).toStrictEqual([job]);
    expect(destroy).toHaveBeenCalledOnce();
    expect(register.mock.calls[0]?.[0]).toBe(
      kind === "job" ? "symbols.run" : "symbols.Symbol(run)",
    );

    expect(schedule.mock.calls).toStrictEqual(
      kind === "cron" ? [["@daily", "symbols.Symbol(run)", {}, {}]] : [],
    );
  });
});
