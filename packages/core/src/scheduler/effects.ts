import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type * as Fiber from "effect/Fiber";

export const attempt = <A>(operation: () => A): Effect.Effect<A, unknown> =>
  Effect.try({ try: operation, catch: (error) => error });
export const fromPromise = <A>(operation: () => PromiseLike<A>): Effect.Effect<A, unknown> =>
  Effect.tryPromise({
    try: async () => await Promise.resolve(operation()),
    catch: (error) => error,
  });
export const observeTimerFailure = <A, E>(fiber: Fiber.Fiber<A, E>): Fiber.Fiber<A, E> => {
  fiber.addObserver((exit) => {
    if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) {
      throw Cause.squash(exit.cause);
    }
  });
  return fiber;
};
export const observeBackgroundFailure = <A, E>(fiber: Fiber.Fiber<A, E>): Fiber.Fiber<A, E> => {
  fiber.addObserver((exit) => {
    if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) {
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- Preserve the original rejected value when reporting detached Effect failures to native observers.
      void Promise.reject(Cause.squash(exit.cause));
    }
  });
  return fiber;
};
