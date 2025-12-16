import type { ObjectId } from 'mongodb';

/**
 * Job status constants using `as const` pattern for type safety and tree-shaking.
 * 
 * @example
 * ```typescript
 * if (job.status === JobStatus.PENDING) {
 *   // job is ready to process
 * }
 * ```
 */
export const JobStatus = {
  /** Job is waiting to be processed */
  PENDING: 'pending',
  /** Job is currently being executed by a worker */
  PROCESSING: 'processing',
  /** Job finished successfully */
  COMPLETED: 'completed',
  /** Job permanently failed after max retries */
  FAILED: 'failed',
} as const;

/**
 * Union type of all possible job statuses.
 */
export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

/**
 * Represents a job in the Monque queue.
 * 
 * @template T - The type of the job's data payload
 * 
 * @example
 * ```typescript
 * interface EmailJobData {
 *   to: string;
 *   subject: string;
 *   template: string;
 * }
 * 
 * const job: IJob<EmailJobData> = {
 *   name: 'send-email',
 *   data: { to: 'user@example.com', subject: 'Welcome!', template: 'welcome' },
 *   status: JobStatus.PENDING,
 *   nextRunAt: new Date(),
 *   failCount: 0,
 *   createdAt: new Date(),
 *   updatedAt: new Date(),
 * };
 * ```
 */
export interface IJob<T = unknown> {
  /** MongoDB document identifier */
  _id?: ObjectId;

  /** Job type identifier, matches worker registration */
  name: string;

  /** Job payload - must be JSON-serializable */
  data: T;

  /** Current lifecycle state */
  status: JobStatus;

  /** When the job should be processed */
  nextRunAt: Date;

  /** Timestamp when job was locked for processing */
  lockedAt?: Date | null;

  /** Number of failed attempts */
  failCount: number;

  /** Last failure error message */
  failReason?: string;

  /** Cron expression for recurring jobs */
  repeatInterval?: string;

  /** Deduplication key to prevent duplicate jobs */
  uniqueKey?: string;

  /** Job creation timestamp */
  createdAt: Date;

  /** Last modification timestamp */
  updatedAt: Date;
}

/**
 * Options for enqueueing a job.
 * 
 * @example
 * ```typescript
 * await monque.enqueue('sync-user', { userId: '123' }, {
 *   uniqueKey: 'sync-user-123',
 *   runAt: new Date(Date.now() + 5000), // Run in 5 seconds
 * });
 * ```
 */
export interface EnqueueOptions {
  /**
   * Deduplication key. If a job with this key is already pending or processing,
   * the enqueue operation will not create a duplicate.
   */
  uniqueKey?: string;

  /**
   * When the job should be processed. Defaults to immediately (new Date()).
   */
  runAt?: Date;
}

/**
 * Handler function signature for processing jobs.
 * 
 * @template T - The type of the job's data payload
 * 
 * @example
 * ```typescript
 * const emailHandler: JobHandler<EmailJobData> = async (job) => {
 *   await sendEmail(job.data.to, job.data.subject);
 * };
 * ```
 */
export type JobHandler<T = unknown> = (job: IJob<T>) => Promise<void> | void;

/**
 * Configuration options for the Monque scheduler.
 * 
 * @example
 * ```typescript
 * const monque = new Monque(db, {
 *   collectionName: 'jobs',
 *   pollInterval: 1000,
 *   maxRetries: 10,
 *   baseRetryInterval: 1000,
 *   shutdownTimeout: 30000,
 *   defaultConcurrency: 5,
 * });
 * ```
 */
export interface MonqueOptions {
  /**
   * Name of the MongoDB collection for storing jobs.
   * @default 'monque_jobs'
   */
  collectionName?: string;

  /**
   * Interval in milliseconds between polling for new jobs.
   * @default 1000
   */
  pollInterval?: number;

  /**
   * Maximum number of retry attempts before marking a job as permanently failed.
   * @default 10
   */
  maxRetries?: number;

  /**
   * Base interval in milliseconds for exponential backoff calculation.
   * Actual delay = 2^failCount * baseRetryInterval
   * @default 1000
   */
  baseRetryInterval?: number;

  /**
   * Timeout in milliseconds for graceful shutdown.
   * @default 30000
   */
  shutdownTimeout?: number;

  /**
   * Default number of concurrent jobs per worker.
   * @default 5
   */
  defaultConcurrency?: number;
}

/**
 * Event payloads for Monque lifecycle events.
 */
export interface MonqueEventMap {
  /**
   * Emitted when a job begins processing.
   */
  'job:start': IJob;

  /**
   * Emitted when a job finishes successfully.
   */
  'job:complete': {
    job: IJob;
    /** Processing duration in milliseconds */
    duration: number;
  };

  /**
   * Emitted when a job fails (may retry).
   */
  'job:fail': {
    job: IJob;
    error: Error;
    /** Whether the job will be retried */
    willRetry: boolean;
  };

  /**
   * Emitted for unexpected errors during processing.
   */
  'job:error': {
    error: Error;
    job?: IJob;
  };
}

/**
 * Options for the @Job decorator in @monque/tsed.
 * 
 * @example
 * ```typescript
 * @Job({ name: 'send-email' })
 * class SendEmailJob {
 *   async handle(job: IJob<EmailJobData>) {
 *     // ...
 *   }
 * }
 * ```
 */
export interface JobDecoratorOptions {
  /** Job type identifier - must match when enqueueing */
  name: string;

  /**
   * Number of concurrent jobs this worker can process.
   * @default 5
   */
  concurrency?: number;
}

/**
 * Configuration options for MonqueModule in @monque/tsed.
 * 
 * @example
 * ```typescript
 * // With Mongoose
 * MonqueModule.forRoot({
 *   connection: mongooseConnection,
 * });
 * 
 * // With native MongoDB
 * MonqueModule.forRoot({
 *   connection: mongoDb,
 *   collectionName: 'custom_jobs',
 * });
 * ```
 */
export interface MonqueModuleOptions extends MonqueOptions {
  /**
   * MongoDB connection - can be either a Mongoose Connection or native MongoDB Db instance.
   */
  connection: unknown;
}
