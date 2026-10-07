import * as Schema from "effect/Schema";

import { InvalidJobPriorityError } from "../errors.js";

const decodePriority = Schema.decodeUnknownSync(Schema.Int);

/** Validate supplied priorities without coercion; undefined means the default. */
export function validateJobPriority(priority: unknown): void {
  if (priority === undefined) return;
  try {
    decodePriority(priority);
  } catch {
    throw new InvalidJobPriorityError();
  }
}
