import * as Schema from "effect/Schema";

import { InvalidJobPriorityError } from "../errors.js";

const decodePriority = Schema.decodeUnknownSync(Schema.Int);
/** Validate supplied priorities without coercion; undefined means the default. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This public validator accepts untrusted values and parses them with the priority schema below.
export const validateJobPriority = (priority: unknown): void => {
  if (priority === undefined) {
    return;
  }
  try {
    decodePriority(priority);
  } catch {
    throw new InvalidJobPriorityError();
  }
};
