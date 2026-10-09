import type { Job } from "@/jobs";

import { captureErrorStack } from "./capture-error-stack.js";
import { MonqueError } from "./monque-error.js";

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
  public readonly incompleteJobs: Job[];
  constructor(message: string, incompleteJobs: Job[]) {
    super(message);
    this.incompleteJobs = incompleteJobs;
    this.name = "ShutdownTimeoutError";
    captureErrorStack(this, ShutdownTimeoutError);
  }
}
