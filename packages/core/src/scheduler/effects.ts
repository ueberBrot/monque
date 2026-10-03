import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type * as Fiber from "effect/Fiber";

export function attempt<A>(operation: () => A): Effect.Effect<A, unknown> {
  return Effect.try({ try: operation, catch: (error) => error });
}

export function fromPromise<A>(operation: () => PromiseLike<A>): Effect.Effect<A, unknown> {
  return Effect.tryPromise({
    try: () => Promise.resolve(operation()),
    catch: (error) => error,
  });
}

export function observeTimerFailure<A, E>(fiber: Fiber.Fiber<A, E>): Fiber.Fiber<A, E> {
  fiber.addObserver((exit) => {
    if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) {
      throw Cause.squash(exit.cause);
    }
  });
  return fiber;
}

export function observeBackgroundFailure<A, E>(fiber: Fiber.Fiber<A, E>): Fiber.Fiber<A, E> {
  fiber.addObserver((exit) => {
    if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) {
      void Promise.reject(Cause.squash(exit.cause));
    }
  });
  return fiber;
}
