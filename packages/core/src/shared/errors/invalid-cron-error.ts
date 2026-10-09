import { captureErrorStack } from "./capture-error-stack.js";
import { MonqueError } from "./monque-error.js";

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
  public readonly expression: string;
  constructor(expression: string, message: string) {
    super(message);
    this.expression = expression;
    this.name = "InvalidCronError";
    captureErrorStack(this, InvalidCronError);
  }
}
