import { captureErrorStack } from "./capture-error-stack.js";
import { MonqueError } from "./monque-error.js";

/**
 * Error thrown when a job payload exceeds the configured maximum BSON byte size.
 *
 * @example
 * ```typescript
 * const monque = new Monque(db, { maxPayloadSize: 1_000_000 }); // 1 MB
 *
 * try {
 *   await monque.enqueue('job', hugePayload);
 * } catch (error) {
 *   if (error instanceof PayloadTooLargeError) {
 *     console.error(`Payload ${error.actualSize} bytes exceeds limit ${error.maxSize} bytes`);
 *   }
 * }
 * ```
 */
export class PayloadTooLargeError extends MonqueError {
  public readonly actualSize: number;
  public readonly maxSize: number;
  constructor(message: string, actualSize: number, maxSize: number) {
    super(message);
    this.actualSize = actualSize;
    this.maxSize = maxSize;
    this.name = "PayloadTooLargeError";
    captureErrorStack(this, PayloadTooLargeError);
  }
}
