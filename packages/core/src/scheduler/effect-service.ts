import { Context, Effect, Layer } from "effect";
import type { Db } from "mongodb";

import { Monque } from "./monque.js";
import type { MonqueOptions } from "./types.js";

/** Scoped scheduler operations. The application retains ownership of its database. */
export class MonqueEffect extends Context.Service<MonqueEffect, Monque["effects"]>()(
  "@monque/core/MonqueEffect",
) {
  static layer(db: Db, options: MonqueOptions = {}) {
    return Layer.effect(
      MonqueEffect,
      Effect.map(Monque.scoped(db, options), (monque) => monque.effects),
    );
  }
}
