/**
 * MonqueModule - Main Integration Module
 *
 * Orchestrates the integration between Monque and Ts.ED.
 * Handles lifecycle hooks, configuration resolution, and worker registration.
 */

import {
	type Job,
	Monque,
	type MonqueOptions,
	type ScheduleOptions,
	type WorkerOptions,
} from '@monque/core';
import {
	Configuration,
	DIContext,
	Inject,
	InjectorService,
	LOGGER,
	Module,
	type OnDestroy,
	type OnInit,
	ProviderScope,
	runInContext,
	type TokenProvider,
} from '@tsed/di';

import { type MonqueTsedConfig, validateDatabaseConfig } from '@/config';
import { ProviderTypes } from '@/constants';
import { MonqueService } from '@/services';
import { collectWorkerMetadata, resolveDatabase } from '@/utils';

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
		this.monqueConfig = configuration.get<MonqueTsedConfig>('monque') || {};
	}

	async $onInit(): Promise<void> {
		const config = this.monqueConfig;

		if (config?.enabled === false) {
			this.logger.info('Monque integration is disabled');

			return;
		}

		validateDatabaseConfig(config);

		try {
			const db = await resolveDatabase(config, (token) =>
				this.injector.get(token as TokenProvider),
			);

			// We construct the options object carefully to match MonqueOptions
			const { db: _db, ...restConfig } = config;
			const options: MonqueOptions = restConfig;

			this.monque = new Monque(db, options);
			this.monqueService._setMonque(this.monque);

			this.logger.info('Monque: Connecting to MongoDB...');
			await this.monque.initialize();

			if (config.disableJobProcessing) {
				this.logger.info('Monque: Job processing is disabled for this instance');
			} else {
				await this.registerWorkers();
				await this.monque.start();
				this.logger.info('Monque: Started successfully');
			}
		} catch (error) {
			this.logger.error({
				event: 'MONQUE_INIT_ERROR',
				message: 'Failed to initialize Monque',
				error,
			});

			throw error;
		}
	}

	async $onDestroy(): Promise<void> {
		if (this.monque) {
			this.logger.info('Monque: Stopping...');

			await this.monque.stop();

			this.logger.info('Monque: Stopped');
		}
	}

	/**
	 * Discover and register all workers from @WorkerController providers
	 */
	protected async registerWorkers(): Promise<void> {
		if (!this.monque) {
			throw new Error('Monque instance not initialized');
		}

		const monque = this.monque;
		const workerControllers = this.injector.getProviders(ProviderTypes.WORKER_CONTROLLER);
		const registeredJobs = new Set<string>();

		this.logger.info(`Monque: Found ${workerControllers.length} worker controllers`);

		for (const provider of workerControllers) {
			const useClass = provider.useClass;
			const workers = collectWorkerMetadata(useClass);
			// Try to resolve singleton instance immediately
			const instance = this.injector.get(provider.token);

			if (!instance && provider.scope !== ProviderScope.REQUEST) {
				this.logger.warn(
					`Monque: Could not resolve instance for controller ${provider.name}. Skipping.`,
				);

				continue;
			}

			for (const worker of workers) {
				const { fullName, method, opts, isCron, cronPattern } = worker;

				if (registeredJobs.has(fullName)) {
					throw new Error(
						`Monque: Duplicate job registration detected. Job "${fullName}" is already registered.`,
					);
				}

				registeredJobs.add(fullName);

				const handler = async (job: Job) => {
					const $ctx = new DIContext({
						injector: this.injector,
						id: job._id?.toString() || 'unknown',
					});
					$ctx.set('MONQUE_JOB', job);
					$ctx.container.set(DIContext, $ctx);

					await runInContext($ctx, async () => {
						try {
							let targetInstance = instance;
							if (provider.scope === ProviderScope.REQUEST || !targetInstance) {
								targetInstance = await this.injector.invoke(provider.token, {
									locals: $ctx.container,
								});
							}

							const typedInstance = targetInstance as Record<string, (job: Job) => unknown>;

							if (typedInstance && typeof typedInstance[method] === 'function') {
								await typedInstance[method](job);
							}
						} catch (error) {
							this.logger.error({
								event: 'MONQUE_JOB_ERROR',
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

				if (isCron && cronPattern) {
					this.logger.debug(`Monque: Registering cron job "${fullName}" (${cronPattern})`);

					monque.register(fullName, handler, opts as WorkerOptions);
					await monque.schedule(cronPattern, fullName, {}, opts as ScheduleOptions);
				} else {
					this.logger.debug(`Monque: Registering worker "${fullName}"`);
					monque.register(fullName, handler, opts as WorkerOptions);
				}
			}
		}

		this.logger.info(`Monque: Registered ${registeredJobs.size} jobs`);
	}
}
