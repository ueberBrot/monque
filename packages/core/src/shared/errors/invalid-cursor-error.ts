import { captureErrorStack } from "./capture-error-stack.js";
import { MonqueError } from "./monque-error.js";

/**
 * Error thrown when a pagination cursor is invalid or malformed.
 *
 * @example
 * ```typescript
 * try {
 *   await monque.listJobs({ cursor: 'invalid-cursor' });
 * } catch (error) {
 *   if (error instanceof InvalidCursorError) {
 *     console.error('Invalid cursor provided');
 *   }
 * }
 * ```
 */
export class InvalidCursorError extends MonqueError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCursorError";
    captureErrorStack(this, InvalidCursorError);
  }
}
