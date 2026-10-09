import type { StandardSchemaV1 } from "@standard-schema/spec";

import { NonRetryableError } from "./non-retryable-error.js";

/** A worker schema rejected the persisted payload. The handler is not invoked. */
export class PayloadValidationError extends NonRetryableError {
  public readonly jobName: string;
  public readonly issues: readonly StandardSchemaV1.Issue[];
  constructor(jobName: string, issues: readonly StandardSchemaV1.Issue[]) {
    super(
      `Invalid payload for job "${jobName}": ${issues.map((issue) => issue.message).join("; ")}`,
    );
    this.jobName = jobName;
    this.issues = issues;
    this.name = "PayloadValidationError";
  }
}
