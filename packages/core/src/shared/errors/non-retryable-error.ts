import { MonqueError } from "./monque-error.js";

/**
 * Throw from a worker handler to fail a job without automatic retries.
 * Recurring jobs stop too. Operators can still retry the failed job manually.
 */
export class NonRetryableError extends MonqueError {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableError";
  }
}
