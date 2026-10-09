/**
 * MonqueModule - Main Integration Module
 *
 * Orchestrates the integration between Monque and Ts.ED.
 * Handles lifecycle hooks, configuration resolution, and job registration.
 */

import { Monque, MonqueError, WorkerRegistrationError } from "@monque/core";
import type { Job, MonqueOptions, ScheduleOptions, WorkerOptions } from "@monque/core";
import {
  Configuration,
  DIContext,
  Inject,
  InjectorService,
  LOGGER,
  Module,
  ProviderScope,
  runInContext,
} from "@tsed/di";
import type { OnDestroy, OnInit, Provider } from "@tsed/di";

import { validateDatabaseConfig } from "@/config";
import type { MonqueTsedConfig } from "@/config";
import { ProviderTypes } from "@/constants";
import { MonqueService } from "@/services";
import { collectJobMetadata, resolveDatabase } from "@/utils";

@Module({
  imports: [MonqueService],
})
export class MonqueModule implements OnInit, OnDestroy {
  protected injector: InjectorService;
  protected monqueService: MonqueService;
  protected logger: LOGGER;
  protected monqueConfig: MonqueTsedConfig;

  protected monque: Monque | null = null;

  constructor(
    @Inject(InjectorService) injector: InjectorService,
    @Inject(MonqueService) monqueService: MonqueService,
    @Inject(LOGGER) logger: LOGGER,
    @Inject(Configuration) configuration: Configuration,
  ) {
    this.injector = injector;
    this.monqueService = monqueService;
    this.logger = logger;
    this.monqueConfig = configuration.get<MonqueTsedConfig | undefined>("monque") ?? {};
  }

  async $onInit(): Promise<void> {
    const config = this.monqueConfig;

    if (config?.enabled === false) {
      this.logger.info("Monque integration is disabled");

      return;
    }

    validateDatabaseConfig(config);

    try {
      const db = await resolveDatabase(config, (token) => this.injector.get(token));

      // We construct the options object carefully to match MonqueOptions
      const { db: _db, ...restConfig } = config;
      const options: MonqueOptions = restConfig;

      this.monque = new Monque(db, options);
      this.monqueService._setMonque(this.monque);

      this.logger.info("Monque: Connecting to MongoDB...");
      await this.monque.initialize();

      if (config.disableJobProcessing === true) {
        this.logger.info("Monque: Job processing is disabled for this instance");
      } else {
        await this.registerJobs();
        this.monque.start();
        this.logger.info("Monque: Started successfully");
      }
    } catch (error) {
      this.logger.error({
        event: "MONQUE_INIT_ERROR",
        message: "Failed to initialize Monque",
        error,
      });

      throw error;
    }
  }

  async $onDestroy(): Promise<void> {
    if (this.monque) {
      this.logger.info("Monque: Stopping...");

      await this.monque.stop();

      this.logger.info("Monque: Stopped");
    }
  }

  /**
   * Discover and register all jobs from @JobController providers
   */
  protected async registerJobs(): Promise<void> {
    if (!this.monque) {
      throw new MonqueError("Monque instance not initialized");
    }

    const { monque } = this;
    const jobControllers: Provider<unknown>[] = this.injector.providers.getMany(
      ProviderTypes.JOB_CONTROLLER,
    );
    const registeredJobs = new Set<string>();

    this.logger.info(`Monque: Found ${jobControllers.length} job controllers`);

    for (const provider of jobControllers) {
      const { useClass } = provider;
      const jobs = collectJobMetadata(useClass);
      // Try to resolve singleton instance immediately
      // oxlint-disable-next-line typescript/no-unsafe-argument -- TsED types Provider.token as any; forward the same registered DI token unchanged.
      const instance: unknown = this.injector.get<unknown>(provider.token);

      if (
        (instance === null || instance === undefined) &&
        provider.scope !== ProviderScope.REQUEST
      ) {
        this.logger.warn(
          `Monque: Could not resolve instance for controller ${provider.name}. Skipping.`,
        );

        continue;
      }

      for (const metadata of jobs) {
        const { fullName, method, opts, isCron, cronPattern } = metadata;

        if (registeredJobs.has(fullName)) {
          throw new WorkerRegistrationError(
            `Monque: Duplicate job registration detected. Job "${fullName}" is already registered.`,
            fullName,
          );
        }

        registeredJobs.add(fullName);

        const handler = async (job: Job) => {
          const $ctx = new DIContext({
            injector: this.injector,
            id: job._id?.toString() ?? "unknown",
          });
          $ctx.set("MONQUE_JOB", job);
          $ctx.container.set(DIContext, $ctx);

          await runInContext($ctx, async () => {
            try {
              let targetInstance: unknown = instance;
              if (
                provider.scope === ProviderScope.REQUEST ||
                targetInstance === null ||
                targetInstance === undefined
              ) {
                // oxlint-disable-next-line typescript/no-unsafe-argument -- TsED types Provider.token as any; forward the same registered DI token unchanged.
                targetInstance = await this.injector.invoke<unknown>(provider.token, {
                  locals: $ctx.container,
                });
              }

              /* oxlint-disable anti-slop/no-runtime-typeof, anti-slop/no-reflect-get -- Runtime DI instances and decorator method names form this dynamic invocation boundary; preserve the method receiver. */
              if (
                targetInstance !== null &&
                (typeof targetInstance === "object" || typeof targetInstance === "function")
              ) {
                const jobMethod: unknown = Reflect.get(targetInstance, method);
                if (typeof jobMethod === "function") {
                  await jobMethod.call(targetInstance, job);
                }
              }
              /* oxlint-enable anti-slop/no-runtime-typeof, anti-slop/no-reflect-get */
            } catch (error) {
              this.logger.error({
                event: "MONQUE_JOB_ERROR",
                jobName: fullName,
                jobId: job._id,
                message: `Error processing job ${fullName}`,
                error,
              });
              throw error;
            } finally {
              await $ctx.destroy();
            }
          });
        };

        if (isCron && cronPattern !== undefined && cronPattern !== "") {
          this.logger.debug(`Monque: Registering cron job "${fullName}" (${cronPattern})`);

          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SAFETY: Preserve the public mergeable metadata interface and forward its original options object.
          monque.register(fullName, handler, opts as WorkerOptions);
          // oxlint-disable-next-line eslint/no-await-in-loop, typescript/no-unsafe-type-assertion -- SAFETY: Register cron jobs sequentially; isCron identifies the schedule metadata while its public interface remains mergeable.
          await monque.schedule(cronPattern, fullName, {}, opts as ScheduleOptions);
        } else {
          this.logger.debug(`Monque: Registering job "${fullName}"`);
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SAFETY: Preserve the public mergeable metadata interface and forward its original options object.
          monque.register(fullName, handler, opts as WorkerOptions);
        }
      }
    }

    this.logger.info(`Monque: Registered ${registeredJobs.size} jobs`);
  }
}
