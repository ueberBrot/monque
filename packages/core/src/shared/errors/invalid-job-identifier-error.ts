import { captureErrorStack } from "./capture-error-stack.js";
import { MonqueError } from "./monque-error.js";

/**
 * Error thrown when a public job identifier fails validation.
 *
 * @example
 * ```typescript
 * try {
 *   await monque.enqueue('invalid job name', {});
 * } catch (error) {
 *   if (error instanceof InvalidJobIdentifierError) {
 *     console.error(`Invalid ${error.field}: ${error.message}`);
 *   }
 * }
 * ```
 */
export class InvalidJobIdentifierError extends MonqueError {
  public readonly field: "name" | "uniqueKey";
  public readonly value: string;
  constructor(field: "name" | "uniqueKey", value: string, message: string) {
    super(message);
    this.field = field;
    this.value = value;
    this.name = "InvalidJobIdentifierError";
    captureErrorStack(this, InvalidJobIdentifierError);
  }
}
