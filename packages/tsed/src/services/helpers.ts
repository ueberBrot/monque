import crypto from 'node:crypto';
import type { Job, Monque } from '@monque/core';
import { Store, type Type } from '@tsed/core';
import {
	constant,
	DIContext,
	inject,
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
 */
export function getOpts(): MonqueSettings {
	return constant<MonqueSettings>('monque', { enabled: false });
}

/**
 * Resolve database connection from configuration.
 */
export async function resolveDatabase(opts: MonqueSettings): Promise<Db> {
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
 */
export async function registerController(monque: Monque, provider: Provider): Promise<void> {
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
						const instance = inject(ControllerClass) as Record<string, unknown>;
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
						const instance = inject(ControllerClass) as Record<string, unknown>;
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
 */
export function createMonqueProxy(monque: Monque): Monque {
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
 */
export async function afterListen(monque: Monque): Promise<void> {
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
 */
export async function onDestroy(monque: Monque): Promise<void> {
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
