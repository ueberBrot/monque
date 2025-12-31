import type {
	EnqueueOptions,
	Job,
	JobHandler,
	Monque,
	MonquePublicAPI,
	PersistedJob,
	ScheduleOptions,
	WorkerOptions,
} from '@monque/core';
import { injectable } from '@tsed/di';

import { runInJobContext } from '@/utils/runInJobContext.js';

/**
 * Ts.ED-aware wrapper around the Monque scheduler.
 *
 * This service provides the same API as the core `Monque` class but automatically
 * wraps all job handlers in a fresh DI context, enabling request-scoped dependency
 * injection within job execution.
 *
 * When you call `worker()`, the handler is automatically wrapped with `runInContext`,
 * creating an isolated DI scope for each job execution. This allows job handlers to
 * inject request-scoped services like database connections, loggers, or API clients.
 *
 * **Key differences from raw Monque:**
 * - `worker()` handlers run inside a `DIContext`
 * - Each job gets a unique context ID (the job's `_id`)
 * - Context is destroyed after handler completes (success or failure)
 * - All other methods (`enqueue`, `schedule`, `now`) work identically
 *
 * @example Basic usage
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
 *
 * @example Registering a worker with DI-aware execution
 * ```typescript
 * @Service()
 * class JobRegistration {
 *   @Inject()
 *   private monqueService: MonqueService;
 *
 *   @Inject()
 *   private orderProcessor: OrderProcessor;
 *
 *   $onInit() {
 *     this.monqueService.worker<OrderData>('process-order', async (job) => {
 *       // This runs inside a DIContext - request-scoped services work!
 *       await this.orderProcessor.process(job.data);
 *     });
 *   }
 * }
 * ```
 */
export class MonqueService implements MonquePublicAPI {
	private monque: Monque | null = null;

	/**
	 * Sets the underlying Monque instance.
	 * Called internally by `MonqueModule.$onInit()`.
	 *
	 * @param monque - The initialized Monque scheduler instance
	 * @internal
	 */
	setMonque(monque: Monque): void {
		this.monque = monque;
	}

	/**
	 * Returns the underlying Monque instance.
	 * Use this for advanced operations not exposed by the service interface.
	 *
	 * @returns The Monque instance or null if not initialized
	 */
	getMonque(): Monque | null {
		return this.monque;
	}

	/**
	 * Enqueue a job for processing.
	 *
	 * @param name - Job type identifier
	 * @param data - Job payload data
	 * @param options - Enqueueing options
	 * @returns The created job document, or existing job if duplicate uniqueKey
	 */
	async enqueue<T>(name: string, data: T, options?: EnqueueOptions): Promise<PersistedJob<T>> {
		const monque = this.getMonqueOrThrow();
		return monque.enqueue(name, data, options);
	}

	/**
	 * Enqueue a job for immediate processing (syntactic sugar).
	 *
	 * @param name - Job type identifier
	 * @param data - Job payload data
	 * @returns The created job document
	 */
	async now<T>(name: string, data: T): Promise<PersistedJob<T>> {
		const monque = this.getMonqueOrThrow();
		return monque.now(name, data);
	}

	/**
	 * Schedule a recurring job with a cron expression.
	 *
	 * @param cron - Cron expression (5-field format)
	 * @param name - Job type identifier
	 * @param data - Job payload data
	 * @param options - Scheduling options (uniqueKey for deduplication)
	 * @returns The created job document, or existing job if duplicate uniqueKey
	 */
	async schedule<T>(
		cron: string,
		name: string,
		data: T,
		options?: ScheduleOptions,
	): Promise<PersistedJob<T>> {
		const monque = this.getMonqueOrThrow();
		return monque.schedule(cron, name, data, options);
	}

	/**
	 * Register a worker to process jobs of a specific type.
	 *
	 * The handler is automatically wrapped with `runInContext`, creating
	 * a fresh DI scope for each job execution. This enables request-scoped
	 * dependency injection within job handlers.
	 *
	 * @param name - Job type identifier to handle
	 * @param handler - Function to process jobs
	 * @param options - Worker configuration options
	 */
	worker<T>(name: string, handler: JobHandler<T>, options?: WorkerOptions): void {
		const monque = this.getMonqueOrThrow();

		const wrappedHandler = async (job: Job<T>): Promise<void> => {
			await this.executeInContext(job, handler);
		};

		monque.worker(name, wrappedHandler, options);
	}

	/**
	 * Start polling for and processing jobs.
	 */
	start(): void {
		const monque = this.getMonqueOrThrow();
		monque.start();
	}

	/**
	 * Stop the scheduler gracefully, waiting for in-progress jobs to complete.
	 *
	 * @returns Promise that resolves when shutdown is complete
	 */
	async stop(): Promise<void> {
		if (this.monque) {
			await this.monque.stop();
		}
	}

	/**
	 * Check if the scheduler is healthy (running and connected).
	 *
	 * @returns true if scheduler is running and database connection is active
	 */
	isHealthy(): boolean {
		return this.monque?.isHealthy() ?? false;
	}

	/**
	 * Executes a handler within a fresh DI context.
	 *
	 * @param job - The job being processed
	 * @param handler - The handler function to execute
	 * @internal
	 */
	private async executeInContext<T>(job: Job<T>, handler: JobHandler<T>): Promise<void> {
		await runInJobContext(job, async () => {
			await handler(job);
		});
	}

	/**
	 * Returns the Monque instance or throws if not initialized.
	 * @throws Error if Monque is not initialized
	 */
	private getMonqueOrThrow(): Monque {
		if (!this.monque) {
			throw new Error('MonqueService not initialized. Ensure MonqueModule is properly configured.');
		}
		return this.monque;
	}
}

injectable(MonqueService);
