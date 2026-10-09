import { MonqueError } from "./monque-error.js";

/** Error thrown when a job query contains invalid filters or pagination options. */
export class InvalidJobQueryError extends MonqueError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidJobQueryError";
  }
}
