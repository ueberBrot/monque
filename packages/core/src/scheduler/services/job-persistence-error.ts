import { Schema } from "effect";

/** Infrastructure failure; the native cause is retained without serialization. */
// oxlint-disable-next-line unicorn/throw-new-error -- TaggedError is a schema class factory, not an Error constructor.
export class JobPersistenceError extends Schema.TaggedError<
  JobPersistenceError,
  { readonly brand: unique symbol }
>()("JobPersistenceError", { cause: Schema.Defect() }) {}
