import { Context, Effect, Layer, Scope } from "effect";
import type { Db } from "mongodb";

import type { MonqueError } from "../shared/errors/monque-error.js";
import { Monque } from "./monque.js";
import type { MonqueOptions } from "./types.js";

/** Scoped scheduler operations. The application retains ownership of its database. */
export class MonqueEffect extends Context.Service<MonqueEffect, Monque["effects"]>()(
  "@monque/core/MonqueEffect",
) {
  /** Setup runs after initialization and before start. Without setup, processing stays stopped. */
  static layer<A = void, E = never, R = never>(
    db: Db,
    options: MonqueOptions = {},
    setup?: (monque: Monque) => Effect.Effect<A, E, R>,
  ): Layer.Layer<MonqueEffect, MonqueError | E, Exclude<R, Scope.Scope>> {
    return Layer.effect(
      MonqueEffect,
      Effect.gen(function* acquireConfiguredScheduler() {
        const setupScope = yield* Scope.fork(yield* Scope.Scope);
        const monque = yield* Monque.scoped(db, options);

        if (setup) {
          yield* setup(monque).pipe(Scope.provide(setupScope));
          yield* monque.effects.start;
        }

        return monque.effects;
      }),
    );
  }
}
