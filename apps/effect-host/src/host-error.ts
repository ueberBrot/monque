import { Data } from "effect";

export class HostError extends Data.TaggedError("HostError")<{ readonly message: string }> {}
