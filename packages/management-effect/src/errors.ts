import { Data } from "effect";

/** A failure converting or dispatching the transport; domain errors retain their protocol encoding. */
export class ManagementTransportError extends Data.TaggedError("ManagementTransportError")<{
  cause: unknown;
}> {}
