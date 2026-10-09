import { captureErrorStack } from "./capture-error-stack.js";

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
    this.name = "MonqueError";
    // Maintains proper stack trace for where our error was thrown (only available on V8)
    captureErrorStack(this, MonqueError);
  }
}
