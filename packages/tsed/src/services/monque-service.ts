import crypto from 'node:crypto';
import { type Job, Monque } from '@monque/core';
import { Store, type Type } from '@tsed/core';
import {
	constant,
	DIContext,
	inject,
	injectable,
	injector,
	logger,
	type Provider,
	runInContext,
} from '@tsed/di';
import { $asyncEmit } from '@tsed/hooks';
import { type Db, MongoClient } from 'mongodb';

import { runInJobContext } from '@/dispatch/index.js';
import type { ControllerStore } from '@/jobs/index.js';
import type { MonqueSettings } from '@/services/types.js';
import { MONQUE_METADATA, MonqueTypes } from '@/shared/index.js';

/**
 * Get Monque configuration from DI container.
 *
 * @returns Configuration object with enabled defaulting to false
 * @internal
 */
function getOpts(): MonqueSettings {
	return constant<MonqueSettings>('monque', { enabled: false });
}

/**
 * Resolve database connection from configuration.
 *
 * Supports multiple connection modes:
 * - Direct Db instance
 * - Async Db factory function
 * - MongoClient instance
 * - Connection URL string
 *
 * @param opts - Monque configuration
 * @returns Resolved MongoDB database instance
 * @throws {Error} If no database connection is configured
 * @internal
 */
async function resolveDatabase(opts: MonqueSettings): Promise<Db> {
	if (opts.db) {
		return typeof opts.db === 'function' ? await opts.db() : opts.db;
	}

	if (opts.client) {
		return opts.client.db();
	}

	if (opts.url) {
		const client = new MongoClient(opts.url);
		await client.connect();
		return client.db();
	}

	throw new Error(
		'No database connection configured. Provide one of: url, client, or db in monque configuration.',
	);
}

/**
 * Register all job handlers from a controller class.
 *
 * Scans the controller for `@Job` and `@Cron` decorated methods and
 * registers them with the Monque scheduler.
 *
 * @param monque - The Monque instance
 * @param provider - The controller provider to register
 * @internal
 */
async function registerController(monque: Monque, provider: Provider): Promise<void> {
	const ControllerClass = provider.useClass as Type;
	const store = Store.from(ControllerClass);
	const controllerMeta = store.get<ControllerStore>(MONQUE_METADATA);
	const namespace = store.get<{ namespace?: string }>('monque')?.namespace;

	if (!controllerMeta) {
		return;
	}

	if (controllerMeta.jobs) {
		for (const [methodName, jobMeta] of Object.entries(controllerMeta.jobs)) {
			const fullJobName = namespace ? `${namespace}.${jobMeta.name}` : jobMeta.name;
			const workerOptions = jobMeta.options?.concurrency
				? { concurrency: jobMeta.options.concurrency }
				: undefined;

			monque.worker(
				fullJobName,
				async (job: Job<unknown>) => {
					await runInJobContext(job, async () => {
						const instance = inject(ControllerClass);
						const method = instance[methodName];
						if (typeof method !== 'function') {
							throw new Error(`Method "${methodName}" not found on ${ControllerClass.name}`);
						}
						await method.call(instance, job.data, job);
					});
				},
				workerOptions,
			);
		}
	}

	if (controllerMeta.cron) {
		for (const [methodName, cronMeta] of Object.entries(controllerMeta.cron)) {
			const baseName = cronMeta.name ?? `${ControllerClass.name}.${methodName}`;
			const fullJobName = namespace ? `${namespace}.${baseName}` : baseName;

			const uniqueKey = cronMeta.options?.uniqueKey ?? `cron:${ControllerClass.name}.${methodName}`;

			const workerOptions = cronMeta.options?.concurrency
				? { concurrency: cronMeta.options.concurrency }
				: undefined;

			monque.worker(
				fullJobName,
				async (job: Job<unknown>) => {
					await runInJobContext(job, async () => {
						const instance = inject(ControllerClass);
						const method = instance[methodName];
						if (typeof method !== 'function') {
							throw new Error(`Method "${methodName}" not found on ${ControllerClass.name}`);
						}
						await method.call(instance, job.data, job);
					});
				},
				workerOptions,
			);

			await monque.schedule(cronMeta.expression, fullJobName, {}, { uniqueKey });
		}
	}
}

/**
 * Create a Proxy around Monque instance to intercept worker registration.
 *
 * Wraps the `worker()` method to automatically inject DI context for each job execution.
 * This enables request-scoped dependency injection within job handlers.
 *
 * @param monque - The Monque instance to wrap
 * @returns Proxied Monque instance
 * @internal
 */
function createMonqueProxy(monque: Monque): Monque {
	return new Proxy(monque, {
		get(target, prop) {
			if (prop === 'worker') {
				return <T>(
					name: string,
					handler: (job: Job<T>) => Promise<void>,
					options?: { concurrency?: number },
				) => {
					return target.worker<T>(
						name,
						async (job: Job<T>) => {
							const $ctx = new DIContext({
								id: crypto.randomUUID(),
							});

							$ctx.set('job', job);

							return runInContext($ctx, () => handler(job));
						},
						options,
					);
				};
			}

			return Reflect.get(target, prop, target);
		},
	});
}

/**
 * Lifecycle hook called after server starts listening.
 *
 * Initializes the Monque scheduler, discovers controllers, and starts job processing.
 *
 * @param monque - The Monque instance
 * @internal
 */
async function afterListen(monque: Monque): Promise<void> {
	const opts = getOpts();

	if (!opts.enabled) {
		return;
	}

	logger().info({
		event: 'MONQUE_INIT',
		message: 'Initializing Monque scheduler',
	});

	await monque.initialize();

	const providers = injector().getProviders(MonqueTypes.CONTROLLER);

	logger().info({
		event: 'MONQUE_REGISTER_CONTROLLERS',
		message: `Registering ${providers.length} job controllers`,
	});

	for (const provider of providers) {
		await registerController(monque, provider);
	}

	await $asyncEmit('$beforeMonqueStart');

	monque.start();

	logger().info({
		event: 'MONQUE_STARTED',
		message: 'Monque scheduler started',
	});

	await $asyncEmit('$afterMonqueStart');
}

/**
 * Lifecycle hook called on server shutdown.
 *
 * Gracefully stops the Monque scheduler, waiting for in-progress jobs to complete.
 *
 * @param monque - The Monque instance
 * @internal
 */
async function onDestroy(monque: Monque): Promise<void> {
	const opts = getOpts();

	if (!opts.enabled) {
		return;
	}

	logger().info({
		event: 'MONQUE_SHUTDOWN',
		message: 'Gracefully shutting down Monque',
	});

	await monque.stop();

	logger().info({
		event: 'MONQUE_STOPPED',
		message: 'Monque stopped',
	});
}

/**
 * Ts.ED service for Monque job scheduler integration.
 *
 * This service is automatically initialized using the `injectable().factory()` pattern
 * and provides seamless integration with Ts.ED's dependency injection system.
 *
 * **Configuration:**
 * Configure via `@Configuration({ monque: { enabled: true, ... } })` in your server.
 * The scheduler remains inactive unless `enabled: true` is set.
 *
 * **Lifecycle:**
 * - `$afterListen`: Initializes Monque, discovers `@JobController` providers, registers workers, starts scheduler
 * - `$onDestroy`: Gracefully stops the scheduler, waits for in-progress jobs
 *
 * **DI Context:**
 * All job handlers registered via `worker()` automatically run inside a fresh DI context,
 * enabling request-scoped dependency injection.
 *
 * @example Basic setup
 * ```typescript
 * @Configuration({
 *   monque: {
 *     enabled: true,
 *     url: 'mongodb://localhost:27017/myapp',
 *     pollInterval: 1000
 *   }
 * })
 * export class Server {}
 * ```
 *
 * @example Programmatic job enqueueing
 * ```typescript
 * @Controller('/orders')
 * class OrderController {
 *   @Inject()
 *   private monque: Monque;
 *
 *   @Post('/')
 *   async createOrder(@BodyParams() data: CreateOrderDto) {
 *     const order = await this.orderService.create(data);
 *     await this.monque.enqueue('process-order', { orderId: order.id });
 *     return order;
 *   }
 * }
 * ```
 *
 * @example Controller pattern
 * ```typescript
 * @JobController({ namespace: 'email' })
 * class EmailJobs {
 *   @Inject()
 *   private emailService: EmailService;
 *
 *   @Job('send-welcome')
 *   async sendWelcome(data: WelcomeData, job: Job<WelcomeData>) {
 *     await this.emailService.sendWelcome(data.email);
 *   }
 * }
 * ```
 */
export const MonqueService = injectable(Monque)
	.factory(async () => {
		const opts = getOpts();

		if (!opts.enabled) {
			return new Proxy(
				{},
				{
					get: () => () => Promise.resolve(),
				},
			) as unknown as Monque;
		}

		const db = await resolveDatabase(opts);

		const monque = new Monque(db, opts);

		return createMonqueProxy(monque);
	})
	.hooks({
		$afterListen: afterListen,
		$onDestroy: onDestroy,
	})
	.token();

export type MonqueService = Monque;
