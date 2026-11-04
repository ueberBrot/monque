import { Schema } from "effect";

import { MonqueError } from "../errors.js";

const isValidRunAt = Schema.is(Schema.Date);

/** Reject invalid Dates before BSON can turn them into an immediate run. */
export const validateJobRunAt = (runAt: Date): void => {
  if (!isValidRunAt(runAt)) {
    throw new MonqueError("runAt must be a valid Date");
  }
};
