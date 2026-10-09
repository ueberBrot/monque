import { MonqueError } from "./monque-error.js";

/** A priority supplied at runtime is not a signed JavaScript safe integer. */
export class InvalidJobPriorityError extends MonqueError {
  constructor() {
    super("Priority must be a signed safe integer");
    this.name = "InvalidJobPriorityError";
  }
}
