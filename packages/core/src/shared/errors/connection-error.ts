import { captureErrorStack } from "./capture-error-stack.js";
import { MonqueError } from "./monque-error.js";

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
  constructor(
    message: string,
    options?: {
      cause?: Error;
    },
  ) {
    super(message);
    this.name = "ConnectionError";
    if (options?.cause) {
      this.cause = options.cause;
    }
    captureErrorStack(this, ConnectionError);
  }
}
