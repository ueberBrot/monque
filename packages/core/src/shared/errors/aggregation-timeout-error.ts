import { captureErrorStack } from "./capture-error-stack.js";
import { MonqueError } from "./monque-error.js";

/**
 * Error thrown when a statistics aggregation times out.
 *
 * @example
 * ```typescript
 * try {
 *   const stats = await monque.getQueueStats();
 * } catch (error) {
 *   if (error instanceof AggregationTimeoutError) {
 *     console.error('Stats took too long to calculate');
 *   }
 * }
 * ```
 */
export class AggregationTimeoutError extends MonqueError {
  constructor(message = "Statistics aggregation exceeded 30 second timeout") {
    super(message);
    this.name = "AggregationTimeoutError";
    captureErrorStack(this, AggregationTimeoutError);
  }
}
