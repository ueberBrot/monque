import { Effect } from "effect";

export const attempt = function attempt<A>(operation: () => A): Effect.Effect<A, unknown> {
  return Effect.try({
    try: operation,
    catch: (error) => error,
  });
};

export const fromPromise = function fromPromise<A>(
  operation: () => A | PromiseLike<A>,
): Effect.Effect<A, unknown> {
  return Effect.tryPromise({
    try: async () => await operation(),
    catch: (error) => error,
  });
};

/** Parallel request work remains owned by the calling fiber. */
export const concurrently = <A, E, R>(operations: Iterable<Effect.Effect<A, E, R>>) =>
  Effect.all(operations, { concurrency: "unbounded" });
