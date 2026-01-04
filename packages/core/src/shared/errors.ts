import type { Job } from '@/jobs';

/**
 * Base error class for all Monque-related errors.
 *
 * @example
 * ```typescript
 * try {
 *   await monque.enqueue('job', data);
 * } catch (error) {
 *   if (error instanceof MonqueError) {
 *     console.error('Monque error:', error.message);
 *   }
 * }
 * ```
 */
export class MonqueError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'MonqueError';
		// Maintains proper stack trace for where our error was thrown (only available on V8)
		/* istanbul ignore next -- @preserve captureStackTrace is always available in Node.js */
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, MonqueError);
		}
	}
}

/**
 * Error thrown when an invalid cron expression is provided.
 *
 * @example
 * ```typescript
 * try {
 *   await monque.schedule('invalid cron', 'job', data);
 * } catch (error) {
 *   if (error instanceof InvalidCronError) {
 *     console.error('Invalid expression:', error.expression);
 *   }
 * }
 * ```
 */
export class InvalidCronError extends MonqueError {
	constructor(
		public readonly expression: string,
		message: string,
	) {
		super(message);
		this.name = 'InvalidCronError';
		/* istanbul ignore next -- @preserve captureStackTrace is always available in Node.js */
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, InvalidCronError);
		}
	}
}

/**
 * Error thrown when there's a database connection issue.
 *
 * @example
 * ```typescript
 * try {
 *   await monque.enqueue('job', data);
 * } catch (error) {
 *   if (error instanceof ConnectionError) {
 *     console.error('Database connection lost');
 *   }
 * }
 * ```
 */
export class ConnectionError extends MonqueError {
	constructor(message: string) {
		super(message);
		this.name = 'ConnectionError';
		/* istanbul ignore next -- @preserve captureStackTrace is always available in Node.js */
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, ConnectionError);
		}
	}
}

/**
 * Error thrown when graceful shutdown times out.
 * Includes information about jobs that were still in progress.
 *
 * @example
 * ```typescript
 * try {
 *   await monque.stop();
 * } catch (error) {
 *   if (error instanceof ShutdownTimeoutError) {
 *     console.error('Incomplete jobs:', error.incompleteJobs.length);
 *   }
 * }
 * ```
 */
export class ShutdownTimeoutError extends MonqueError {
	constructor(
		message: string,
		public readonly incompleteJobs: Job[],
	) {
		super(message);
		this.name = 'ShutdownTimeoutError';
		/* istanbul ignore next -- @preserve captureStackTrace is always available in Node.js */
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, ShutdownTimeoutError);
		}
	}
}

/**
 * Error thrown when attempting to register a worker for a job name
 * that already has a registered worker, without explicitly allowing replacement.
 *
 * @example
 * ```typescript
 * try {
 *   monque.worker('send-email', handler1);
 *   monque.worker('send-email', handler2); // throws
 * } catch (error) {
 *   if (error instanceof WorkerRegistrationError) {
 *     console.error('Worker already registered for:', error.jobName);
 *   }
 * }
 *
 * // To intentionally replace a worker:
 * monque.worker('send-email', handler2, { replace: true });
 * ```
 */
export class WorkerRegistrationError extends MonqueError {
	constructor(
		message: string,
		public readonly jobName: string,
	) {
		super(message);
		this.name = 'WorkerRegistrationError';
		/* istanbul ignore next -- @preserve captureStackTrace is always available in Node.js */
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, WorkerRegistrationError);
		}
	}
}
