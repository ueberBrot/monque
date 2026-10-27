import { captureErrorStack } from "./capture-error-stack.js";
import { MonqueError } from "./monque-error.js";

/**
 * Error thrown when a state transition is invalid.
 *
 * @example
 * ```typescript
 * try {
 *   await monque.cancelJob(jobId);
 * } catch (error) {
 *   if (error instanceof JobStateError) {
 *      console.error(`Cannot cancel job in state: ${error.currentStatus}`);
 *   }
 * }
 * ```
 */
export class JobStateError extends MonqueError {
  public readonly jobId: string;
  public readonly currentStatus: string;
  // oxlint-disable-next-line sonarjs/max-union-size -- This closed union enumerates the supported domain values without widening the contract.
  public readonly attemptedAction: "cancel" | "retry" | "reschedule" | "setJobPriority";
  constructor(
    message: string,
    jobId: string,
    currentStatus: string,
    // oxlint-disable-next-line sonarjs/max-union-size -- This closed union enumerates the supported domain values without widening the contract.
    attemptedAction: "cancel" | "retry" | "reschedule" | "setJobPriority",
  ) {
    super(message);
    this.jobId = jobId;
    this.currentStatus = currentStatus;
    this.attemptedAction = attemptedAction;
    this.name = "JobStateError";
    captureErrorStack(this, JobStateError);
  }
}
