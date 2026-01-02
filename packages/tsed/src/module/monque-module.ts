import { type Job, Monque, type MonqueOptions } from '@monque/core';
import { Store, type Type } from '@tsed/core';
import {
	constant,
	inject,
	injectable,
	injector,
	type OnDestroy,
	type OnInit,
	ProviderType,
} from '@tsed/di';
import type { Db } from 'mongodb';

import { runInJobContext } from '@/dispatch/index.js';
import type { ControllerStore } from '@/jobs/index.js';
import { MonqueService } from '@/services/index.js';
import { MONQUE_METADATA, MonqueTypes } from '@/shared/index.js';

/**
 * Configuration interface for MonqueModule.
 *
 * Defines the required database connection and optional Monque scheduler settings.
 * Pass this configuration via `@Configuration({ monque: { ... } })` in your Ts.ED server.
 *
 * @example Basic configuration
 * ```typescript
 * @Configuration({
 *   monque: {
 *     db: () => mongoClient.db('myapp'),
 *   }
 * })
 * export class Server {}
 * ```
 *
 * @example With scheduler options
 * ```typescript
 * @Configuration({
 *   monque: {
 *     db: () => mongoClient.db('myapp'),
 *     options: {
 *       pollInterval: 1000,
 *       maxRetries: 5,
 *       shutdownTimeout: 30000,
 *     }
 *   }
 * })
 * export class Server {}
 * ```
 */
export interface MonqueModuleConfig {
	/**
	 * MongoDB database instance or async factory function.
	 *
	 * Use a factory function for lazy initialization when the database
	 * connection is established after module loading.
	 */
	db: Db | (() => Db | Promise<Db>);

	/**
	 * Optional Monque scheduler configuration.
	 *
	 * @see MonqueOptions for available options
	 */
	options?: MonqueOptions;
}

/**
 * Ts.ED Module for Monque job scheduler integration.
 *
 * Provides automatic discovery of `@JobController` decorated controllers
 * and manages the Monque scheduler lifecycle.
 *
 * **Controller Pattern** (`@JobController` + method decorators):
 * Controllers with `@Job` and `@Cron` decorated methods for grouping
 * related job handlers with optional namespace prefixing.
 *
 * **Lifecycle:**
 * - `$onInit`: Creates Monque instance, discovers providers, registers workers, starts scheduler
 * - `$onDestroy`: Gracefully stops the scheduler, waits for in-progress jobs
 *
 * **Configuration:**
 * Configure the module via `@Configuration({ monque: { db, options } })`.
 * If no configuration is provided, the module remains inactive.
 *
 * @example Controller pattern with namespace
 * ```typescript
 * @JobController({ namespace: 'email' })
 * class EmailJobs {
 *   @Inject()
 *   private emailService: EmailService;
 *
 *   @Job('send-welcome')  // Registered as 'email.send-welcome'
 *   async sendWelcome(data: WelcomeData, job: Job<WelcomeData>) {
 *     await this.emailService.sendWelcome(data.email);
 *   }
 *
 *   @Cron('0 9 * * *')  // Daily digest at 9 AM
 *   async sendDailyDigest(data: DigestData, job: Job<DigestData>) {
 *     await this.emailService.sendDigest();
 *   }
 * }
 * ```
 *
 * @example Using MonqueService for programmatic job enqueueing
 * ```typescript
 * @Controller('/orders')
 * class OrderController {
 *   @Inject()
 *   private monqueService: MonqueService;
 *
 *   @Post('/')
 *   async createOrder(@BodyParams() data: CreateOrderDto) {
 *     const order = await this.orderService.create(data);
 *     await this.monqueService.enqueue('process-order', { orderId: order.id });
 *     return order;
 *   }
 * }
 * ```
 */
export class MonqueModule implements OnInit, OnDestroy {
	private monque: Monque | null = null;
	private readonly monqueService = inject(MonqueService);

	/**
	 * Gets the module configuration from the DI container.
	 *
	 * @returns The Monque configuration or undefined if not configured
	 */
	get config(): MonqueModuleConfig | undefined {
		return constant<MonqueModuleConfig>('monque');
	}

	/**
	 * Checks if the module is enabled (has configuration).
	 *
	 * @returns `true` if the `monque` configuration is present
	 */
	isEnabled(): boolean {
		return !!this.config;
	}

	/**
	 * Initializes the Monque scheduler on module startup.
	 *
	 * This lifecycle hook:
	 * 1. Resolves the database connection (supports async factory)
	 * 2. Creates the Monque scheduler instance
	 * 3. Discovers all `@JobController` decorated classes via DI
	 * 4. Registers each `@Job` decorated method as a worker
	 * 5. Schedules all `@Cron` decorated methods
	 * 6. Starts the scheduler (begins processing jobs)
	 *
	 * If no configuration is provided, this method returns early without action.
	 *
	 * @returns Promise that resolves when initialization is complete
	 */
	async $onInit(): Promise<void> {
		const config = this.config;

		if (!config) {
			return;
		}

		const db = typeof config.db === 'function' ? await config.db() : config.db;

		this.monque = new Monque(db, config.options);
		this.monqueService.setMonque(this.monque);

		// Discover and register @JobController providers
		const controllerProviders = injector().getProviders(MonqueTypes.CONTROLLER);
		for (const provider of controllerProviders) {
			await this.registerController(this.monque, provider.useClass as Type);
		}

		this.monque.start();
	}

	/**
	 * Gracefully stops the Monque scheduler on module destruction.
	 *
	 * Waits for in-progress jobs to complete before returning.
	 * Respects the configured `shutdownTimeout` (default: 30 seconds).
	 *
	 * @returns Promise that resolves when the scheduler has stopped
	 */
	async $onDestroy(): Promise<void> {
		if (this.monque) {
			await this.monque.stop();
			this.monque = null;
		}
	}

	/**
	 * Returns the Monque instance for direct access.
	 *
	 * Use this to enqueue jobs programmatically from controllers or services.
	 * Returns `null` if the module is not configured or not yet initialized.
	 *
	 * @returns The Monque scheduler instance, or `null` if not initialized
	 * @deprecated Use `MonqueService` instead for DI-aware job handling
	 *
	 * @example
	 * ```typescript
	 * const monque = this.monqueModule.getMonque();
	 * if (monque) {
	 *   await monque.enqueue('send-notification', { userId: '123' });
	 * }
	 * ```
	 */
	getMonque(): Monque | null {
		return this.monque;
	}

	/**
	 * Registers all job handlers from a controller class.
	 *
	 * Scans the controller for `@Job` and `@Cron` decorated methods and
	 * registers them with the Monque scheduler.
	 *
	 * @param monque - The Monque instance (guaranteed non-null at call site)
	 * @param ControllerClass - The controller class to register
	 * @internal
	 */
	private async registerController(monque: Monque, ControllerClass: Type): Promise<void> {
		const store = Store.from(ControllerClass);
		const controllerMeta = store.get<ControllerStore>(MONQUE_METADATA);
		const namespace = store.get<{ namespace?: string }>('monque')?.namespace;

		if (!controllerMeta) {
			return;
		}

		// Register @Job decorated methods
		if (controllerMeta.jobs) {
			for (const [methodName, jobMeta] of Object.entries(controllerMeta.jobs)) {
				const fullJobName = namespace ? `${namespace}.${jobMeta.name}` : jobMeta.name;
				const workerOptions = jobMeta.options?.concurrency
					? { concurrency: jobMeta.options.concurrency }
					: undefined;

				monque.worker(
					fullJobName,
					async (job: Job<unknown>) => {
						await this.executeControllerMethod(ControllerClass, methodName, job);
					},
					workerOptions,
				);
			}
		}

		// Register @Cron decorated methods
		if (controllerMeta.cron) {
			for (const [methodName, cronMeta] of Object.entries(controllerMeta.cron)) {
				// Generate job name: use provided name, or controller.method pattern
				const baseName = cronMeta.name ?? `${ControllerClass.name}.${methodName}`;
				const fullJobName = namespace ? `${namespace}.${baseName}` : baseName;

				// Generate unique key to prevent duplicate cron jobs
				const uniqueKey =
					cronMeta.options?.uniqueKey ?? `cron:${ControllerClass.name}.${methodName}`;

				const workerOptions = cronMeta.options?.concurrency
					? { concurrency: cronMeta.options.concurrency }
					: undefined;

				// Register the worker
				monque.worker(
					fullJobName,
					async (job: Job<unknown>) => {
						await this.executeControllerMethod(ControllerClass, methodName, job);
					},
					workerOptions,
				);

				// Schedule the cron job
				await monque.schedule(cronMeta.expression, fullJobName, {}, { uniqueKey });
			}
		}
	}

	/**
	 * Executes a controller method within a fresh DI context.
	 *
	 * @param ControllerClass - The controller class
	 * @param methodName - The method to invoke
	 * @param job - The job being processed
	 * @internal
	 */
	private async executeControllerMethod<T>(
		ControllerClass: Type,
		methodName: string,
		job: Job<T>,
	): Promise<void> {
		await runInJobContext(job, async () => {
			const instance = inject(ControllerClass);
			const method = instance[methodName];
			if (typeof method !== 'function') {
				throw new Error(`Method "${methodName}" not found on ${ControllerClass.name}`);
			}
			await method.call(instance, job.data, job);
		});
	}
}

injectable(MonqueModule).type(ProviderType.MODULE);
