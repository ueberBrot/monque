import { Monque } from '@monque/core';
import { injectable } from '@tsed/di';

import { afterListen, createMonqueProxy, getOpts, onDestroy, resolveDatabase } from './helpers.js';

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
 *   private monque: MonqueService;
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
