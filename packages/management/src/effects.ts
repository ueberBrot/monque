import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

export function attempt<A>(operation: () => A): Effect.Effect<A, unknown> {
  return Effect.try({
    try: operation,
    catch: (error) => error,
  });
}

export function fromPromise<A>(operation: () => A | PromiseLike<A>): Effect.Effect<A, unknown> {
  return Effect.tryPromise({
    try: () => Promise.resolve(operation()),
    catch: (error) => error,
  });
}

export const concurrently = Effect.fnUntraced(function* <A, E>(
  operations: Iterable<Effect.Effect<A, E>>,
) {
  const fibers = yield* Effect.forEach(operations, (operation) =>
    Effect.forkDetach(operation, { startImmediately: true }),
  );
  return yield* Fiber.joinAll(fibers);
});
