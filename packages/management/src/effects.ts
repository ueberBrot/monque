import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

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

export const concurrently = Effect.fnUntraced(function* concurrently<A, E>(
  operations: Iterable<Effect.Effect<A, E>>,
) {
  // oxlint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-method-this-argument -- Effect.forEach traverses Effects, not an Array callback.
  const fibers = yield* Effect.forEach(operations, (operation) =>
    Effect.forkDetach(operation, { startImmediately: true }),
  );
  return yield* Fiber.joinAll(fibers);
});
