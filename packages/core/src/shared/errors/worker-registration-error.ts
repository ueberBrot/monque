import { captureErrorStack } from "./capture-error-stack.js";
import { MonqueError } from "./monque-error.js";

/**
 * Error thrown when attempting to register a worker for a job name
 * that already has a registered worker, without explicitly allowing replacement.
 *
 * @example
 * ```typescript
 * try {
 *   monque.register('send-email', handler1);
 *   monque.register('send-email', handler2); // throws
 * } catch (error) {
 *   if (error instanceof WorkerRegistrationError) {
 *     console.error('Worker already registered for:', error.jobName);
 *   }
 * }
 *
 * // To intentionally replace a worker:
 * monque.register('send-email', handler2, { replace: true });
 * ```
 */
export class WorkerRegistrationError extends MonqueError {
  public readonly jobName: string;
  constructor(message: string, jobName: string) {
    super(message);
    this.jobName = jobName;
    this.name = "WorkerRegistrationError";
    captureErrorStack(this, WorkerRegistrationError);
  }
}
